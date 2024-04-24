import express from 'express';
import sqlite3 from 'sqlite3';
import { Telegraf } from 'telegraf';
import fs from 'fs';
import path from 'path'; // Додавання модулю path
import fetch from 'node-fetch'; // Додавання модулю node-fetch

const app = express();
const PORT = process.env.PORT || 3001;

const db = new sqlite3.Database('posts.db');
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, photo_path TEXT, caption TEXT)");
});
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

app.use(express.json());

app.get('/posts', (req, res) => {
    db.all("SELECT * FROM posts", (err, rows) => {
        if (err) {
            res.status(500).send(err.message);
        } else {
            res.json(rows);
        }
    });
});

app.post('/newpost', (req, res) => {
    const { photoPath, caption } = req.body;

    if (!photoPath || !caption) {
        return res.status(400).send('Потрібно надіслати photoPath та caption');
    }

    db.run("INSERT INTO posts (photo_path, caption) VALUES (?, ?)", [photoPath, caption], (err) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Помилка при збереженні посту у базі даних');
        }
        console.log("Новий пост збережено:", { photoPath, caption });
        res.status(200).send('Пост успішно збережено у базі даних');
    });
});

// Обробник для отримання фото по їх ID
app.get('/photos/:photoId', (req, res) => {
    const { photoId } = req.params;
    const photoPath = path.join(__dirname, `${photoId}.jpg`);

    fs.access(photoPath, fs.constants.F_OK, (err) => {
        if (err) {
            console.error(err);
            res.status(404).send('Зображення не знайдено');
        } else {
            res.sendFile(photoPath);
        }
    });
});

app.listen(PORT, () => {
    console.log(`Сервер працює на порті ${PORT}`);
});

const bot = new Telegraf('6403226573:AAEV-wCm9uDxXSrMaQhkVgZedsXYVTDjDbA');

bot.start((ctx) => ctx.reply('Ласкаво просимо! Надсилайте мені фотографії з підписами для ваших постів.'));

bot.on('photo', async (ctx) => {
    const photoId = ctx.message.photo[0].file_id;
    const caption = ctx.message.caption || '';

    try {
        const photo = await ctx.telegram.getFile(photoId);
        const photoPath = path.join(__dirname, `${photoId}.jpg`);


        if (fs.existsSync(photoPath)) {
            console.log("Файл вже існує:", photoPath);
            return ctx.reply('Ця фотографія вже збережена');
        }

        const photoUrl = `https://api.telegram.org/file/bot6403226573:AAEV-wCm9uDxXSrMaQhkVgZedsXYVTDjDbA/${photo.file_path}`;
        const response = await fetch(photoUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        await fs.promises.writeFile(photoPath, buffer);

        db.run("INSERT INTO posts (photo_path, caption) VALUES (?, ?)", [photoPath, caption], (err) => {
            if (err) {
                console.error(err.message);
                ctx.reply('Помилка при збереженні посту у базі даних');
            } else {
                console.log("Новий пост збережено:", { photoPath, caption });
                ctx.reply('Фото та текст успішно завантажено і збережено в базі даних');
            }
        });
    } catch (error) {
        console.error("Помилка обробки фотографії:", error);
        ctx.reply('Помилка при обробці фотографії');
    }
});

bot.on('text', (ctx) => {
    const caption = ctx.message.text || '';

    if (!caption) {
        return ctx.reply('Будь ласка, надішліть текстовий підпис разом з фотографією');
    }

    ctx.reply('Будь ласка, надішліть фотографію разом з текстовим підписом');
});

bot.launch();
