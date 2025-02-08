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
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "Eres un asistente de IA que extrae información de comprobantes de pago." },
                { 
                    role: "user", 
                    content: [
                        { type: "text", text: "Extrae la siguiente información del comprobante de pago en la imagen: Documento, Valor, Beneficiario, Banco, Tipo de pago." },
                        { type: "image_url", image_url: { url: urlTempFile } }
                    ]
                }
            ],
            max_tokens: 300,
        });

        let datosExtraidos;
try {
    // Intenta parsear como JSON
    datosExtraidos = JSON.parse(response.choices[0].message.content);
} catch (error) {
    // Si OpenAI devuelve texto en lugar de JSON, procesarlo manualmente
    console.log("📩 Respuesta de OpenAI:", response.choices[0].message.content);

    const texto = response.choices[0].message.content;

    // Extraer manualmente los datos desde el texto
    const documento = texto.match(/Documento\**:\**\s*(.+)/i)?.[1] || "Desconocido";
    const valor = texto.match(/Valor\**:\**\s*\$(\d+\.\d{2})/i)?.[1] || "0.00";
    const beneficiario = texto.match(/Beneficiario\**:\**\s*(.+)/i)?.[1] || "Desconocido";
    const banco = texto.match(/Banco\**:\**\s*(.+)/i)?.[1] || "Desconocido";
    const tipo = texto.match(/Tipo de pago\**:\**\s*(.+)/i)?.[1] || "Desconocido";

    // Formatear los datos extraídos
    datosExtraidos = { documento, valor, beneficiario, banco, tipo };
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
