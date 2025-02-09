const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const axios = require('axios');
const OpenAI = require('openai');
const moment = require('moment');

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

// Función para convertir imagen a Base64
const getBase64FromUrl = async (imageUrl) => {
    try {
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        const mimeType = response.headers['content-type'];
        return { url: `data:${mimeType};base64,${base64}` };
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
        console.log("📥 Solicitud recibida desde WhatsApp:", req.body);

        const { urlTempFile, from, fullDate } = req.body;
        if (!urlTempFile) {
            return res.status(400).json({ mensaje: 'No se recibió una URL de imagen' });
        }

        // Convertir la imagen a Base64
        const base64Image = await getBase64FromUrl(urlTempFile);
        if (!base64Image) {
            return res.status(400).json({ mensaje: 'Error al procesar la imagen. Intente con otra URL.' });
        }

        // 🔹 Detección de comprobantes falsos con ejemplos
        const detectionResponse = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "Eres un experto en autenticación de comprobantes de pago. Evalúa si esta imagen es un comprobante original o si ha sido editado." },
                { role: "user", content: [
                        { type: "text", text: `Aquí tienes ejemplos de comprobantes reales:

                        **Ejemplo de un depósito impreso:**
                        - Texto impreso con impresora térmica
                        - No tiene colores
                        - Puede tener marcas de agua o sellos
                        - Texto ligeramente borroso o desalineado
                        - Sección de 'Documento' con un número de comprobante claro

                        **Ejemplo de una transferencia digital:**
                        - Imagen en pantalla (captura de pantalla o PDF)
                        - Texto alineado perfectamente
                        - Puede tener colores y logotipos
                        - Número de comprobante visible en la sección 'Número de comprobante' o 'ID de transacción'

                        **Ejemplo de comprobante falso:**
                        - Texto editado digitalmente
                        - Fuentes o tamaños de letra inconsistentes
                        - Desalineación de números o datos
                        - Modificación evidente del monto

                        Analiza esta imagen y responde en formato JSON con:
                        {
                            "es_falso": "true o false",
                            "confianza": "Número entre 0 y 100 que indica qué tan seguro estás de que el comprobante es falso",
                            "razon": "Explica por qué se considera falso si lo es"
                        }` 
                        },
                        { type: "image_url", image_url: { url: base64Image.url } }
                    ] 
                }
            ],
            max_tokens: 100,
            response_format: { type: "json_object" }
        });

        console.log("📩 Respuesta de detección de falsificaciones:", JSON.stringify(detectionResponse, null, 2));

        let resultadoDeteccion;
        try {
            resultadoDeteccion = JSON.parse(detectionResponse.choices[0].message.content);
        } catch (error) {
            console.error("❌ Error al parsear respuesta de detección:", error);
            return res.json({ mensaje: "⚠️ No se pudo verificar si el comprobante es falso. Intente nuevamente o contacte soporte." });
        }

        if (resultadoDeteccion.es_falso === "true" && resultadoDeteccion.confianza > 85) {
            console.log("🚨 Se detectó un comprobante editado o falso.");
            return res.json({
                mensaje: `🚨 *Alerta de comprobante falso*\n\n` +
                         `⚠️ Se ha detectado que esta imagen podría estar editada o manipulada con una confianza del ${resultadoDeteccion.confianza}%.\n` +
                         `📌 *Razón:* ${resultadoDeteccion.razon}\n\n` +
                         `Si crees que esto es un error, contacta con soporte.\n\n` +
                         `👉 *Soporte:* 0980757208 👈`
            });
        }

        // Procesar comprobante si no es falso
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: "Eres un asistente experto en extraer información de comprobantes de pago. Devuelve solo un JSON con los datos requeridos, sin texto adicional." },
                { role: "user", content: [
                        { type: "text", text: `Extrae la siguiente información del comprobante de pago en la imagen y devuélvelo en formato JSON:
                        {
                            "documento": "Número exacto del comprobante o transacción sin palabras adicionales.",
                            "valor": "Monto del pago en formato numérico con dos decimales",
                            "remitente": "Nombre de la persona que realizó la transferencia.",
                            "banco": "Nombre del banco que emitió el comprobante",
                            "tipo": "Indicar 'Depósito' o 'Transferencia' según el comprobante"
                        }`
                        },
                        { type: "image_url", image_url: { url: base64Image.url } }
                    ]
                }
            ],
            max_tokens: 300,
        });

        console.log("📩 Respuesta de OpenAI:", JSON.stringify(response, null, 2));

        const datosExtraidos = JSON.parse(response.choices[0].message.content);

        // Guardar en MySQL
        db.query('INSERT INTO comprobantes (documento, valor, remitente, fecha, tipo, banco, whatsapp) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [datosExtraidos.documento, datosExtraidos.valor, datosExtraidos.remitente || "Desconocido", fullDate, datosExtraidos.tipo, datosExtraidos.banco, from],
            (err, result) => {
                if (err) {
                    console.error("❌ Error en la inserción en MySQL:", err);
                    return res.status(500).json({ error: err.message });
                }
                res.json({ mensaje: `✅ Pago registrado exitosamente. Documento: ${datosExtraidos.documento}.` });
            }
        );

    } catch (error) {
        console.error("❌ Error general:", error.message);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
