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

        const { urlTempFile, from, fullDate } = req.body;
        if (!urlTempFile) {
            return res.status(400).json({ mensaje: 'No se recibió una URL de imagen' });
        }

        // 🔹 Convertir la imagen a Base64
        const base64Image = await getBase64FromUrl(urlTempFile);
        if (!base64Image) {
            return res.status(400).json({ mensaje: 'Error al procesar la imagen. Intente con otra URL.' });
        }

        // 🔹 Enviar a OpenAI con Base64 en lugar de URL
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: "Eres un asistente experto en extraer información de comprobantes de pago. Devuelve solo un JSON con los datos requeridos, sin texto adicional." },
                { 
                    role: "user", 
                    content: [
                        { type: "text", text: `Extrae la siguiente información del comprobante de pago en la imagen y devuélvelo en formato JSON:
                            {
                                "documento": "Número exacto del comprobante o transacción sin palabras adicionales",
                                "valor": "Monto del pago en formato numérico con dos decimales",
                                "beneficiario": "Nombre del remitente o destinatario del pago",
                                "banco": "Nombre del banco que emitió el comprobante",
                                "tipo": "Indicar 'Depósito' o 'Transferencia' según el comprobante"
                            }
                            Devuelve solo el JSON, sin explicaciones ni texto adicional.
                        `},
                        { type: "image_url", image_url: { url: base64Image.url } }
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
            return res.json({ mensaje: 'No se pudo extraer información válida del comprobante. Contacte a soporte: 09999999' });
        }

        // 🔹 Verificar si el número de documento ya existe en la base de datos
        db.query('SELECT * FROM comprobantes WHERE documento = ?', [datosExtraidos.documento], (err, results) => {
            if (err) return res.status(500).json({ error: err.message });

            if (results.length > 0) {
                return res.json({ mensaje: `🚫 Este comprobante ya ha sido registrado: ${datosExtraidos.documento}.` });
            }

            const moment = require('moment'); // Requiere instalar moment.js

            // 🔹 Convertir fullDate a formato 'YYYY-MM-DD HH:mm:ss' para MySQL
            const fechaFormateada = moment(fullDate, "dddd, MMMM D, YYYY HH:mm:ss").format("YYYY-MM-DD HH:mm:ss");


            // 🔹 Insertar en la base de datos si no existe
            db.query('INSERT INTO comprobantes (documento, valor, beneficiario, fecha, tipo, banco) VALUES (?, ?, ?, ?, ?, ?)',
                [datosExtraidos.documento, datosExtraidos.valor, datosExtraidos.beneficiario || "Desconocido", fullDate, datosExtraidos.tipo, datosExtraidos.banco],
                (err, result) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ mensaje: `✅ Pago registrado exitosamente. Documento: ${datosExtraidos.documento}.` });
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
