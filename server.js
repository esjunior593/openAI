const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const axios = require('axios');
const OpenAI = require('openai');
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

// Configuración de OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Ruta para procesar comprobantes desde Builder Bot
app.post('/procesar', async (req, res) => {
    try {
        const { urlTempFile, from, fullDate } = req.body;
        if (!urlTempFile) {
            return res.status(400).json({ mensaje: 'No se recibió una URL de imagen' });
        }
        
        // Solicitar a OpenAI que analice la imagen y devuelva datos estructurados
        // Solicitar a OpenAI que analice la imagen y devuelva datos estructurados
const response = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: "json",  // 🔴 Esto obliga a OpenAI a devolver solo JSON
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
                { type: "image_url", image_url: { url: urlTempFile } }
            ]
        }
    ],
    max_tokens: 300,
});

let datosExtraidos;
try {
    datosExtraidos = response.choices[0].message.content;  // 🔹 OpenAI ya devuelve JSON sin necesidad de `JSON.parse()`
} catch (error) {
    console.error("❌ OpenAI devolvió una respuesta inesperada:", response.choices[0].message.content);
    return res.status(500).json({ error: "Error procesando la imagen. Intente con otra imagen o contacte a soporte." });
}



        // Validar si OpenAI extrajo correctamente la información
        if (!datosExtraidos.documento || !datosExtraidos.valor || !datosExtraidos.banco || !datosExtraidos.tipo) {
            return res.json({ mensaje: 'No se pudo extraer información válida del comprobante. Contacte a soporte: 09999999' });
        }

        // Verificar si el número de documento ya existe en la base de datos
        db.query('SELECT * FROM comprobantes WHERE documento = ?', [datosExtraidos.documento], (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            
            if (results.length > 0) {
                return res.json({ mensaje: `🚫 Este comprobante ya ha sido registrado: ${datosExtraidos.documento}.` });
            }
            
            // Insertar en la base de datos si no existe
            db.query('INSERT INTO comprobantes (documento, valor, beneficiario, fecha, tipo, banco) VALUES (?, ?, ?, ?, ?, ?)',
                [datosExtraidos.documento, datosExtraidos.valor, datosExtraidos.beneficiario || "Desconocido", fullDate, datosExtraidos.tipo, datosExtraidos.banco],
                (err, result) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ mensaje: `✅ Pago registrado exitosamente. Documento: ${datosExtraidos.documento}.` });
                }
            );
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
