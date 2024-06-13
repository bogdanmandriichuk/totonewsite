import express from 'express';
import sqlite3 from 'sqlite3';
import { Telegraf } from 'telegraf';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'posts.db');
const db = new sqlite3.Database(dbPath);

// Create table if it doesn't exist
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, photo_paths TEXT, caption TEXT)");
});

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

app.use(express.json());
app.use('/photos', express.static(path.join(__dirname, 'photos')));

app.get('/posts', (req, res) => {
    db.all("SELECT * FROM posts", (err, rows) => {
        if (err) {
            res.status(500).send(err.message);
        } else {
            res.json(rows);
        }
    });
});

app.post('/newpost', async (req, res) => {
    const { photo_paths, caption } = req.body;

    if (!photo_paths || !caption) {
        return res.status(400).send('Потрібно надіслати photo_paths та caption');
    }

    try {
        const savedPhotoPaths = [];
        for (const photo_path of photo_paths) {
            const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${photo_path}`;
            const response = await fetch(photoUrl);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                const photoFileName = `${Date.now()}_${path.basename(photo_path)}`;
                const photoFilePath = path.join(__dirname, 'photos', photoFileName);
                await fs.writeFile(photoFilePath, buffer);

                savedPhotoPaths.push(photoFileName);
            } else {
                console.error(`Помилка завантаження фото ${photo_path}:`, response.statusText);
            }
        }

        if (savedPhotoPaths.length > 0) {
            db.run("INSERT INTO posts (photo_paths, caption) VALUES (?, ?)", [JSON.stringify(savedPhotoPaths), caption], (err) => {
                if (err) {
                    console.error(err.message);
                    res.status(500).send('Помилка при збереженні посту у базі даних');
                } else {
                    console.log("Новий пост збережено:", { photoPaths: savedPhotoPaths, caption });
                    res.status(200).send('Пост успішно збережено у базі даних');
                }
            });
        } else {
            res.status(400).send('Немає дійсних фото для збереження');
        }
    } catch (error) {
        console.error("Помилка обробки фотографій:", error);
        res.status(500).send('Помилка при збереженні постів у базі даних');
    }
});

app.delete('/posts/:id', (req, res) => {
    const postId = req.params.id;

    db.run("DELETE FROM posts WHERE id = ?", postId, function(err) {
        if (err) {
            console.error(err.message);
            res.status(500).send('Помилка при видаленні посту');
        } else if (this.changes === 0) {
            res.status(404).send('Пост не знайдено');
        } else {
            console.log(`Пост з ID ${postId} видалено`);
            res.status(200).send('Пост успішно видалено');
        }
    });
});

app.get('/photos/:photoId', (req, res) => {
    const { photoId } = req.params;
    const photoPath = path.join(__dirname, 'photos', photoId);

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

// Бот Telegram
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Словник для зберігання тимчасових даних про медіагрупи
const mediaGroupStorage = {};

// Функція для збереження медіагрупи
async function saveMediaGroup(ctx, mediaGroupId) {
    const mediaGroup = mediaGroupStorage[mediaGroupId];
    if (!mediaGroup) {
        console.error(`Media group ${mediaGroupId} не знайдено.`);
        return;
    }

    const { photoPaths, caption } = mediaGroup;

    db.run("INSERT INTO posts (photo_paths, caption) VALUES (?, ?)", [JSON.stringify(photoPaths), caption], (err) => {
        if (err) {
            console.error(err.message);
            ctx.reply('Помилка при збереженні посту у базі даних');
        } else {
            console.log("Новий пост збережено:", { photoPaths, caption });
            ctx.reply('Фото та текст успішно завантажено і збережено в базі даних');
        }
    });

    // Видаляємо дані зі словника після збереження
    delete mediaGroupStorage[mediaGroupId];
}

bot.on('photo', async (ctx) => {
    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const caption = ctx.message.caption || '';
    const mediaGroupId = ctx.message.media_group_id;

    try {
        const photo = await ctx.telegram.getFile(photoId);
        const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${photo.file_path}`;
        const response = await fetch(photoUrl);
        if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const photoFileName = `${Date.now()}_${photo.file_unique_id}.jpg`;
            const photoFilePath = path.join(__dirname, 'photos', photoFileName);
            await fs.writeFile(photoFilePath, buffer);

            if (mediaGroupId) {
                console.log(`Received photo for media group ${mediaGroupId}`);

                if (!mediaGroupStorage[mediaGroupId]) {
                    mediaGroupStorage[mediaGroupId] = { photoPaths: [], caption, count: 0 };
                }
                mediaGroupStorage[mediaGroupId].photoPaths.push(photoFileName);
                mediaGroupStorage[mediaGroupId].count++;

                // Save the media group after a delay to ensure all photos are received
                setTimeout(() => {
                    if (mediaGroupStorage[mediaGroupId] && mediaGroupStorage[mediaGroupId].count > 1) {
                        console.log(`Saving media group ${mediaGroupId} after delay`);
                        saveMediaGroup(ctx, mediaGroupId);
                    }
                }, 2000);
            } else {
                db.run("INSERT INTO posts (photo_paths, caption) VALUES (?, ?)", [JSON.stringify([photoFileName]), caption], (err) => {
                    if (err) {
                        console.error(err.message);
                        ctx.reply('Помилка при збереженні посту у базі даних');
                    } else {
                        console.log("Новий пост збережено:", { photoPaths: [photoFileName], caption });
                        ctx.reply('Фото та текст успішно завантажено і збережено в базі даних');
                    }
                });
            }
        } else {
            console.error(`Помилка завантаження фото ${photoId}:`, response.statusText);
            ctx.reply('Помилка при завантаженні фотографії');
        }
    } catch (error) {
        console.error("Помилка обробки фотографії:", error);
        ctx.reply('Помилка при обробці фотографії');
    }
});

bot.command('deletepost', (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length !== 2) {
        return ctx.reply('Використання: /deletepost [ID]');
    }

    const postId = args[1];

    db.run("DELETE FROM posts WHERE id = ?", postId, function(err) {
        if (err) {
            console.error(err.message);
            ctx.reply('Помилка при видаленні посту');
        } else if (this.changes === 0) {
            ctx.reply('Пост не знайдено');
        } else {
            console.log(`Пост з ID ${postId} видалено`);
            ctx.reply('Пост успішно видалено');
        }
    });
});

bot.on('text', (ctx) => {
    ctx.reply('Будь ласка, надішліть фотографію з підписом.');
});

bot.launch();
