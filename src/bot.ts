import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import * as qrcode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import sharp from 'sharp';
import svg2png from 'svg2png';
import axios from 'axios';

// Загрузка переменных окружения
config();

// Проверка наличия токена
if (!process.env.BOT_TOKEN) {
    console.error('Ошибка: BOT_TOKEN не найден в переменных окружения!');
    console.error('Пожалуйста, создайте файл .env и добавьте в него BOT_TOKEN=your_token_here');
    process.exit(1);
}

// Интерфейс для хранения состояния пользователя
interface UserState {
    waitingForLogo: boolean;
    waitingForUrl: boolean;
    logoPath?: string;
}

// Хранилище состояний пользователей
const userStates = new Map<number, UserState>();

// Функция для очистки папки temp
function cleanupTempFolder() {
    const tempDir = path.join(__dirname, 'temp');
    
    if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
            const filePath = path.join(tempDir, file);
            try {
                fs.unlinkSync(filePath);
            } catch (error) {
                console.error(`Ошибка при удалении файла ${filePath}:`, error);
            }
        }
    }
}

// Функция для обработки ссылки
function processUrl(text: string): string {
    text = text.trim();
    if (!text.match(/^https?:\/\//i)) {
        text = 'https://' + text;
    }
    return text;
}

// Функция для скачивания файла
async function downloadFile(url: string, filePath: string): Promise<void> {
    const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream'
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

// Функция для создания QR-кода с логотипом
async function generateQRWithLogo(url: string, logoPath?: string): Promise<string> {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
    }
    const unique = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const qrCodePath = path.join(tempDir, `${unique}_qr.png`);
    const qrWithLogoPath = path.join(tempDir, `${unique}_qr_logo.png`);
    const qrFinalPath = path.join(tempDir, `${unique}_qr_final.png`);

    // Размеры
    const qrSize = 400;
    const logoSize = 100;
    const padding = 25; // Паддинг вокруг логотипа
    const whiteBoxSize = logoSize + padding * 2;

    // Генерируем QR-код с максимальной коррекцией ошибок
    await qrcode.toFile(qrCodePath, url, {
        width: qrSize,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: {
            dark: '#000000',
            light: '#ffffff'
        }
    });

    if (logoPath) {
        try {
            let logoBuffer: Buffer;
            if (logoPath.endsWith('.svg')) {
                const svgBuffer = fs.readFileSync(logoPath);
                logoBuffer = await svg2png(svgBuffer, { width: logoSize, height: logoSize });
            } else {
                logoBuffer = fs.readFileSync(logoPath);
            }

            // Вырезаем белый квадрат в центре QR-кода
            const qrImage = sharp(qrCodePath);
            const whiteBox = Buffer.from(
                `<svg width='${whiteBoxSize}' height='${whiteBoxSize}'>
                    <rect x='0' y='0' width='${whiteBoxSize}' height='${whiteBoxSize}' fill='white' />
                </svg>`
            );
            await qrImage
                .composite([
                    {
                        input: whiteBox,
                        top: Math.floor((qrSize - whiteBoxSize) / 2),
                        left: Math.floor((qrSize - whiteBoxSize) / 2)
                    }
                ])
                .toFile(qrWithLogoPath);

            // Теперь накладываем логотип на белый квадрат, сохраняем в финальный файл
            await sharp(qrWithLogoPath)
                .composite([
                    {
                        input: logoBuffer,
                        top: Math.floor((qrSize - logoSize) / 2),
                        left: Math.floor((qrSize - logoSize) / 2)
                    }
                ])
                .toFile(qrFinalPath);

            // Удаляем промежуточные файлы
            fs.unlinkSync(qrCodePath);
            fs.unlinkSync(qrWithLogoPath);
            return qrFinalPath;
        } catch (error) {
            console.error('Error adding logo to QR code:', error);
            return qrCodePath; // fallback: возвращаем обычный QR
        }
    }

    return qrCodePath;
}

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);

// Очистка temp при запуске
cleanupTempFolder();

// Периодическая очистка temp каждые 6 часов
setInterval(cleanupTempFolder, 6 * 60 * 60 * 1000);

// Обработка команды /start
bot.command('start', async (ctx) => {
    const welcomeMessage = `
👋 Привет! Я бот для генерации QR-кодов.

📝 Как использовать:
1. Нажмите кнопку "Создать QR-код"
2. Отправьте логотип (или пропустите этот шаг)
3. Отправьте ссылку
4. Получите QR-код с вашим логотипом

🔍 Доступные команды:
/start - Показать это сообщение
/help - Показать справку
    `;

    await ctx.reply(welcomeMessage, Markup.keyboard([
        ['🔄 Создать QR-код']
    ]).resize());
});

// Обработка команды /help
bot.command('help', async (ctx) => {
    const helpMessage = `
📝 Справка по использованию бота:

1. Нажмите кнопку "Создать QR-код"
2. Отправьте логотип в формате SVG (или нажмите "Пропустить")
3. Отправьте ссылку или текст для QR-кода
4. Получите готовый QR-код с вашим логотипом

⚠️ Ограничения:
- Максимальная длина ссылки: 2048 символов
- Поддерживаются только текстовые ссылки
- Логотип должен быть в формате SVG
    `;

    await ctx.reply(helpMessage);
});

// Обработка нажатия кнопки "Создать QR-код"
bot.hears('🔄 Создать QR-код', async (ctx) => {
    const userId = ctx.from.id;
    userStates.set(userId, { waitingForLogo: true, waitingForUrl: false });

    await ctx.reply(
        'Отправь логотип, который ты хочешь вставить в QR-код (можно пропустить).',
        Markup.keyboard([
            ['⏩ Пропустить']
        ]).resize()
    );
});

// Обработка нажатия кнопки "Пропустить"
bot.hears('⏩ Пропустить', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    
    if (state?.waitingForLogo) {
        state.waitingForLogo = false;
        state.waitingForUrl = true;
        userStates.set(userId, state);

        await ctx.reply(
            'Теперь пришли ссылку или текст, который зашить в QR-код.',
            Markup.keyboard([
                ['🔄 Создать QR-код']
            ]).resize()
        );
    }
});

// Обработка получения фото
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);

    if (state?.waitingForLogo) {
        try {
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            const file = await ctx.telegram.getFile(photo.file_id);
            const logoPath = path.join(__dirname, 'temp', `logo_${Date.now()}.svg`);
            
            // Скачиваем логотип
            await downloadFile(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`, logoPath);

            state.logoPath = logoPath;
            state.waitingForLogo = false;
            state.waitingForUrl = true;
            userStates.set(userId, state);

            await ctx.reply(
                'Теперь пришли ссылку или текст, который зашить в QR-код.',
                Markup.keyboard([
                    ['🔄 Создать QR-код']
                ]).resize()
            );
        } catch (error) {
            console.error('Error processing logo:', error);
            await ctx.reply('Произошла ошибка при обработке логотипа. Пожалуйста, попробуйте еще раз.');
        }
    }
});

// Обработка получения SVG-документа
bot.on('document', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);

    if (state?.waitingForLogo) {
        try {
            const document = ctx.message.document;
            // Проверяем, что это SVG
            if (!document.file_name || !document.file_name.endsWith('.svg')) {
                await ctx.reply('Пожалуйста, отправьте логотип в формате SVG.');
                return;
            }
            const file = await ctx.telegram.getFile(document.file_id);
            const logoPath = path.join(__dirname, 'temp', `logo_${Date.now()}.svg`);
            await downloadFile(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`, logoPath);

            state.logoPath = logoPath;
            state.waitingForLogo = false;
            state.waitingForUrl = true;
            userStates.set(userId, state);

            await ctx.reply(
                'Теперь пришли ссылку или текст, который зашить в QR-код.',
                Markup.keyboard([
                    ['🔄 Создать QR-код']
                ]).resize()
            );
        } catch (error) {
            console.error('Error processing SVG logo:', error);
            await ctx.reply('Произошла ошибка при обработке логотипа. Пожалуйста, попробуйте еще раз.');
        }
    }
});

// Обработка текстовых сообщений
bot.on(message('text'), async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    const text = ctx.message.text;

    if (state?.waitingForUrl) {
        let processedUrl: string;
        try {
            processedUrl = processUrl(text);
            new URL(processedUrl);
        } catch {
            await ctx.reply('Пожалуйста, отправьте корректную ссылку!');
            return;
        }

        try {
            const qrCodePath = await generateQRWithLogo(processedUrl, state.logoPath);
            
            // Отправляем QR-код
            await ctx.replyWithPhoto({ source: qrCodePath });

            // Удаляем файл через 5 минут
            setTimeout(() => {
                if (fs.existsSync(qrCodePath)) {
                    try {
                        fs.unlinkSync(qrCodePath);
                    } catch (error) {
                        console.error(`Ошибка при удалении файла ${qrCodePath}:`, error);
                    }
                }
            }, 5 * 60 * 1000);

            // Очищаем состояние пользователя
            userStates.delete(userId);

        } catch (error) {
            console.error('Error generating QR code:', error);
            await ctx.reply('Произошла ошибка при генерации QR-кода. Пожалуйста, попробуйте позже.');
        }
    }
});

// Запуск бота
bot.launch().then(() => {
    console.log('Bot started successfully!');
}).catch((error) => {
    console.error('Error starting bot:', error);
});

// Обработка завершения работы
process.once('SIGINT', () => {
    cleanupTempFolder();
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    cleanupTempFolder();
    bot.stop('SIGTERM');
}); 