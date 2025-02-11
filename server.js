const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const axios = require('axios');
const OpenAI = require('openai');
const moment = require('moment'); // Asegúrate de instalar moment.js con npm

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Configuración de MySQL
const db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    port: process.env.MYSQL_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});


const getBase64FromUrl = async (imageUrl) => {
    try {
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        const mimeType = response.headers['content-type']; // Obtener el tipo MIME de la imagen
        return { url: `data:${mimeType};base64,${base64}` };  // 🔹 Retorna un objeto con la clave correcta
    } catch (error) {
        console.error("❌ Error al convertir imagen a Base64:", error.message);
        return null;
    }
};



// Configuración de OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


// Ruta para procesar comprobantes desde Builder Bot
app.post('/procesar', async (req, res) => {
    try {
        // 🔹 Imprimir todo el body para ver qué datos envía WhatsApp
        console.log("📥 Solicitud recibida desde WhatsApp:", req.body);

        // 🔹 Extraer variables de req.body
        const { urlTempFile, from, fullDate, historial } = req.body; 

        if (!urlTempFile) {
            return res.status(400).json({ mensaje: 'No se recibió una URL de imagen' });
        }

        // 🔹 Convertir la imagen a Base64
        const base64Image = await getBase64FromUrl(urlTempFile);
        if (!base64Image) {
            return res.status(400).json({ mensaje: 'Error al procesar la imagen. Intente con otra URL.' });
        }

        const historialTexto = historial && Array.isArray(historial) && historial.length > 0
    ? historial.map(m => `${m.role}: ${m.content}`).join("\n")
    : "No hay historial disponible.";

// 🔹 Filtrar solo los mensajes del usuario
const historialFiltrado = historial && Array.isArray(historial) 
    ? historial.filter(m => m.role === "user").map(m => m.content).join("\n")
    : "No hay mensajes relevantes del usuario.";

// 🔹 Extraer solo el último mensaje relevante del usuario
const ultimoMensajeUsuario = historial && Array.isArray(historial) 
    ? historial.reverse().find(m => m.role === "user" && /netflix|prime video|disney\+|max|spotify|paramount|crunchyroll/i.test(m.content))?.content || "No hay mensajes previos del usuario."
    : "No hay mensajes previos del usuario.";




        // 🔹 Enviar a OpenAI con Base64 en lugar de URL
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [
                { 
                    role: "system", 
                    content: "Eres un asistente experto en extraer información de comprobantes de pago. Devuelve solo un JSON con los datos requeridos, sin texto adicional." 
                },
                { 
                    role: "user", 
                    content: [
                        { type: "text", text: `Extrae la siguiente información del comprobante de pago en la imagen y devuélvelo en formato JSON:
                            {
                                "documento": "Número exacto del comprobante o transacción sin palabras adicionales. 
El número de comprobante puede aparecer con etiquetas como 'No.', 'Número:', 'Comprobante:', 'Transacción:', 'REF:', 'Referencia:', 'ID:', 'Registro:', 'Código:', o similares. 
Si hay más de un número similar, prioriza el que esté junto a palabras clave como 'Comprobante', 'Referencia' o 'REF'. 
Si el comprobante pertenece a 'Tu Banco Banco Aquí', el número de documento está inmediatamente después de la fecha en formato DD/MM/YYYY HH:MM:SS. 
Encuentra la fecha en la imagen y extrae el primer número que aparece justo después.",
                                "valor": "Monto del pago en formato numérico con dos decimales",
                                "remitente": "Nombre de la persona que realizó la transferencia. 
Debe estar en la sección de 'Cuenta de Origen', 'Desde', 'Ordenante', 'Remitente', 'Pagador' o 'Titular de Cuenta'. 
Si el nombre coincide con 'AMELIA YADIRA RUIZ QUIMI' o 'NELISSA MAROLA QUINTERO QUIMI' o sus variaciones ('Amelia Ruiz', 'Nelissa Quintero', 'Ruiz Quimi', 'Quintero Quimi'), entonces este NO es el remitente, sino el beneficiario, y debe asignarse al campo 'beneficiario'.",

  "beneficiario": "Nombre de la persona que recibió el dinero. 
Debe estar en la sección de 'Cuenta Destino', 'Beneficiario', 'Receptor', 'Para', 'A Favor de', 'Destino' o similar. 
Si el beneficiario no es detectado pero el remitente contiene 'AMELIA YADIRA RUIZ QUIMI' o 'NELISSA MAROLA QUINTERO QUIMI' o una variación de estos nombres, entonces este nombre debe asignarse al campo 'beneficiario'.
Si el nombre del beneficiario tiene errores tipográficos menores, corrígelo automáticamente. 
Si se detecta un nombre que se parece a 'AMELIA YADIRA RUIZ QUIMI' o 'NELISSA MAROLA QUINTERO QUIMI' pero con variaciones como cambios en el orden de las palabras o errores de escritura, normalízalo para que coincida con la versión correcta.",
                                "banco": "Nombre del banco que emitió el comprobante",
                                "tipo": "Indicar 'Depósito' o 'Transferencia' según el comprobante"
                            }
                            Además, revisa el historial de mensajes del cliente y extrae SOLO el servicio de streaming que mencionó antes de pagar. 
                            Si identificas un servicio o producto en el historial, agrégalo bajo la clave "descripcion". 
                            Si no se menciona nada, deja "descripcion": "No especificado".
                            Devuelve solo el JSON, sin explicaciones ni texto adicional.`
                        },
                        { 
                            type: "text", 
                            text: `📜 Último mensaje relevante del cliente:\n${ultimoMensajeUsuario}\n\n
                        📌 Extrae solo el servicio que el cliente solicitó en su último mensaje. 
                        
                        📌 Reglas para extraer correctamente el servicio:
                        1. **Toma solo el último mensaje donde el usuario menciona un servicio.**
                        2. Si el usuario menciona "pantalla" o "dispositivo", usa "Dispositivo" como estándar.
                        3. **No ignores la cantidad mencionada antes del servicio.**
                        4. Si no menciona cantidad, asume que es "1".
                        5. Devuelve solo la cantidad y el nombre del servicio en la clave "descripcion".
                        
                        📌 Ejemplos correctos:
                        - "me gustaría 1 netflix" → "1 Dispositivo de Netflix"
                        - "quiero 2 pantallas de max" → "2 Dispositivos de Max"
                        - "voy a comprar 3 dispositivos de Prime Video" → "3 Dispositivos de Prime Video"
                        - "estoy interesado en 3 pantallas de Spotify" → "3 Dispositivos de Spotify"
                        
                        📌 **No ignores la cantidad.** Si el usuario dice "quiero 3 pantallas de Spotify", la respuesta debe ser "3 Dispositivos de Spotify". Si no menciona cantidad, usa "1".
                        
                        Devuelve solo el servicio bajo la clave "descripcion". Si no hay información del servicio, usa "No especificado".`
                        },
                        { 
                            type: "image_url", 
                            image_url: { url: base64Image.url } 
                        }
                    ]
                }
            ],
            max_tokens: 300,
        });
        
        // 🔹 Mostrar la respuesta de OpenAI en los logs de Railway
        console.log("📩 Respuesta de OpenAI:", JSON.stringify(response, null, 2));
        

        const datosExtraidos = JSON.parse(response.choices[0].message.content);

        // 🔹 Validar si OpenAI extrajo correctamente la información
if (!datosExtraidos.documento || !datosExtraidos.valor || !datosExtraidos.banco || !datosExtraidos.tipo) {
    console.log("🚨 No se detectó un comprobante de pago en la imagen. Enviando mensaje de soporte.");
    
    return res.json({ 
        mensaje: "Si tiene algún problema con su servicio, escriba al número de Soporte por favor.\n\n" +
                 "👉 *Soporte:* 0980757208 👈"
    });
}

// 🔹 Verificar si el comprobante está incompleto
if (!datosExtraidos.documento || !datosExtraidos.valor) {
    console.log("⏳ Comprobante con información incompleta. Enviando mensaje de espera.");
    
    return res.json({ 
        mensaje: "⏳ *Estamos verificando su pago, un momento por favor...*"
    });
}


        // 🔹 Verificar si el número de documento ya existe en la base de datos
        db.query('SELECT * FROM comprobantes WHERE documento = ?', [datosExtraidos.documento], (err, results) => {
            if (err) return res.status(500).json({ error: err.message });

            if (results.length > 0) {
                console.log("🚨 Comprobante ya registrado:", datosExtraidos.documento);
                
                // 🔹 Formatear el número para mostrar solo los últimos 5 dígitos
                const numeroOculto = `09XXX${results[0].whatsapp.slice(-5)}`;

                const moment = require('moment'); // Requiere instalar moment.js

               // 🔹 Convertir fullDate correctamente desde WhatsApp a MySQL
const fechaFormateada = moment(fullDate, "dddd, MMMM D, YYYY HH:mm:ss").format("YYYY-MM-DD HH:mm:ss");

// 🔹 Convertir fullDate al formato para WhatsApp
let fechaWhatsApp = moment(results[0].fecha, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss");


// 🔹 Verificar si la fecha se convirtió correctamente
if (!fechaFormateada || fechaFormateada === "Invalid date") {
    console.error("❌ Error al convertir la fecha:", fullDate);
    return res.status(400).json({ mensaje: "Error al procesar la fecha del comprobante." });
}


                // 🔹 Mensaje indicando que el comprobante ya fue usado
                
                const mensaje = `⛔ *Pago no válido,* presentado por el número *${numeroOculto}*.\n\n` +
                                `📌 *Número:* ${results[0].documento}\n` +
                                `🪀 *Enviado por:* ${numeroOculto}\n` +
                                `🏷️ *Fecha:* ${fechaWhatsApp}\n` +
                                `💰 *Valor:* $${results[0].valor}`;
            
                return res.json({ mensaje });
            }

            const moment = require('moment'); // Requiere instalar moment.js

            // 🔹 Convertir fullDate a formato 'YYYY-MM-DD HH:mm:ss' para MySQL
            const fechaFormateada = moment(fullDate, "dddd, MMMM D, YYYY HH:mm:ss").format("YYYY-MM-DD HH:mm:ss");

// 🔹 Convertir fullDate al formato para WhatsApp
const fechaWhatsApp = moment(fullDate, "dddd, MMMM D, YYYY HH:mm:ss").format("DD-MM-YYYY HH:mm:ss");

// 🔹 Verificar si la fecha se convirtió correctamente
if (!fechaFormateada || fechaFormateada === "Invalid date") {
    console.error("❌ Error al convertir la fecha:", fullDate);
    return res.status(400).json({ mensaje: "Error al procesar la fecha del comprobante." });
}


            // 🔹 Formatear el número de WhatsApp para mostrar solo los últimos 5 dígitos
            const numeroOculto = `09XXX${from.slice(-5)}`; 

            console.log("📥 Intentando guardar en MySQL:", datosExtraidos);

   

           // Lista de beneficiarios válidos
const beneficiariosValidos = [
    "AMELIA YADIRA RUIZ QUIMI",
    "NELISSA MAROLA QUINTERO QUIMI",
    "AMELIA RUIZ",
    "NELISSA QUINTERO",
    "RUIZ QUIMI",
    "QUINTERO QUIMI"
];

// Función para normalizar nombres (elimina tildes y convierte en mayúsculas)
const normalizarTexto = (texto) => {
    return texto
        ? texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
        : "";
};

// 🔹 Si OpenAI no detectó beneficiario, asignar el banco como beneficiario
if (!datosExtraidos.beneficiario || datosExtraidos.beneficiario === "No especificado") {
    console.log("🔍 Beneficiario no detectado, asignando el banco como beneficiario...");
    datosExtraidos.beneficiario = datosExtraidos.banco || "No identificado";
}

// Normalizar nombres detectados
const beneficiarioDetectado = normalizarTexto(datosExtraidos.beneficiario);

// 🔹 Verificar si el beneficiario detectado está en la lista de beneficiarios válidos o es un banco
const esBeneficiarioValido = beneficiariosValidos.some(nombreValido =>
    beneficiarioDetectado.includes(normalizarTexto(nombreValido))
) || datosExtraidos.beneficiario.includes("BANCO");

// 🔹 Si el beneficiario sigue sin ser válido, rechazar el pago
if (!esBeneficiarioValido) {
    console.log(`🚨 Pago rechazado. Beneficiario no válido: ${datosExtraidos.beneficiario}`);
    return res.json({ 
        mensaje: `⛔ *Pago no válido.*\n\n` +
                 `El pago no fue realizado a nuestra cuenta.`
    });
}




            // 🔹 Insertar en la base de datos si no existe
            // 🔹 Insertar en la base de datos con el número de WhatsApp
            const { linea } = req.body; // Obtener la línea desde el body

// 🔹 Insertar en la base de datos con el número de WhatsApp y línea
db.query('INSERT INTO comprobantes (documento, valor, remitente, fecha, tipo, banco, whatsapp, linea, descripcion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [datosExtraidos.documento, datosExtraidos.valor, datosExtraidos.remitente || "Desconocido", fechaFormateada, datosExtraidos.tipo, datosExtraidos.banco, from, linea, datosExtraidos.descripcion || "No especificado"],
    (err, result) => {
        if (err) {
            console.error("❌ Error en la inserción en MySQL:", err);
            return res.status(500).json({ error: err.message });
        }

        console.log("✅ Comprobante guardado en la base de datos:", datosExtraidos.documento);

        // 🔹 Ahora guardar el número de WhatsApp en la tabla de contactos si el pago fue exitoso
        const numeroFormateado = `+${from}`; // Agrega el `+` al número de WhatsApp

db.query('INSERT IGNORE INTO contactos_whatsapp (whatsapp, linea) VALUES (?, ?)', 
    [numeroFormateado, linea], (err, result) => {
        if (err) {
            console.error("❌ Error al guardar contacto en MySQL:", err);
        } else {
            console.log("📞 Contacto guardado:", numeroFormateado, "en", linea);
        }
});

        // 🔹 Mensaje de confirmación en WhatsApp
        const mensaje = `🟢 *_Nuevo pago presentado._*\n\n` +
                        `📌 *Número:* ${datosExtraidos.documento}\n` +
                        `🪀 *Enviado por:* ${from}\n` +
                        `🏷️ *Fecha:* ${fechaFormateada}\n` +
                        `💰 *Valor:* $${datosExtraidos.valor}\n\n` +
                        `Estamos *verificando su pago*...\n\n` +
                        `Agradecemos su espera 🕕`;

        res.json({ mensaje });
    }
);

        });

    } catch (error) {
        console.error("❌ Error general:", error.message);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});



app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
