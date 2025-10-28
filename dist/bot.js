"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const telegraf_1 = require("telegraf");
const filters_1 = require("telegraf/filters");
const qrcode = __importStar(require("qrcode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const dotenv_1 = require("dotenv");
const sharp_1 = __importDefault(require("sharp"));
const svg2png_1 = __importDefault(require("svg2png"));
const axios_1 = __importDefault(require("axios"));
// Загрузка переменных окружения
(0, dotenv_1.config)();
// Проверка наличия токена
if (!process.env.BOT_TOKEN) {
    console.error('Ошибка: BOT_TOKEN не найден в переменных окружения!');
    console.error('Пожалуйста, создайте файл .env и добавьте в него BOT_TOKEN=your_token_here');
    process.exit(1);
}
// Хранилище состояний пользователей
const userStates = new Map();
// Функция для очистки папки temp
function cleanupTempFolder() {
    const tempDir = path.join(__dirname, 'temp');
    if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
            const filePath = path.join(tempDir, file);
            try {
                fs.unlinkSync(filePath);
            }
            catch (error) {
                console.error(`Ошибка при удалении файла ${filePath}:`, error);
            }
        }
    }
}
// Функция для обработки ссылки
function processUrl(text) {
    text = text.trim();
    if (!text.match(/^https?:\/\//i)) {
        text = 'https://' + text;
    }
    return text;
}
// Функция для скачивания файла
async function downloadFile(url, filePath) {
    const response = await (0, axios_1.default)({
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
async function generateQRWithLogo(url, logoPath) {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
    }
    const unique = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const qrCodePath = path.join(tempDir, `${unique}_qr.png`);
    const qrFinalPath = path.join(tempDir, `${unique}_qr_final.png`);
    // Размеры
    const qrSize = 400;
    const margin = 20; // Белое пространство вокруг QR-кода
    const logoSize = 100;
    const padding = 25; // Паддинг вокруг логотипа
    const whiteCircleRadius = (logoSize + padding * 2) / 2;
    // Получаем матрицу QR-кода через низкоуровневый API
    const qr = qrcode.create(url, {
        errorCorrectionLevel: 'H'
    });
    const moduleCount = qr.modules.size;
    // Размер QR-кода без margin (внутренняя область)
    const qrContentSize = qrSize - (margin * 2);
    // Создаем SVG с модифицированной матрицей (без паттернов в центре)
    let svgString = `<svg width="${qrSize}" height="${qrSize}" xmlns="http://www.w3.org/2000/svg">`;
    // Добавляем белый фон
    svgString += `<rect x="0" y="0" width="${qrSize}" height="${qrSize}" fill="#ffffff"/>`;
    const cellSize = qrContentSize / moduleCount;
    const centerX = moduleCount / 2;
    const centerY = moduleCount / 2;
    for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
            const isDark = qr.modules.get(row, col);
            // Сдвигаем координаты на margin
            const x = col * cellSize + margin;
            const y = row * cellSize + margin;
            // Вычисляем расстояние от центра до текущего модуля
            const dx = (col - centerX) * cellSize;
            const dy = (row - centerY) * cellSize;
            const distance = Math.sqrt(dx * dx + dy * dy);
            // Если модуль находится внутри круга для логотипа, делаем его белым
            if (distance < whiteCircleRadius) {
                svgString += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="#ffffff"/>`;
            }
            else {
                svgString += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${isDark ? '#000000' : '#ffffff'}"/>`;
            }
        }
    }
    svgString += '</svg>';
    // Конвертируем SVG в PNG
    const svgBuffer = Buffer.from(svgString);
    const pngBuffer = await (0, sharp_1.default)(svgBuffer).png().toBuffer();
    fs.writeFileSync(qrCodePath, pngBuffer);
    // Если есть логотип, накладываем его
    if (logoPath) {
        try {
            let logoBuffer;
            if (logoPath.endsWith('.svg')) {
                const svgBuffer = fs.readFileSync(logoPath);
                logoBuffer = await (0, svg2png_1.default)(svgBuffer, { width: logoSize, height: logoSize });
            }
            else {
                logoBuffer = fs.readFileSync(logoPath);
            }
            // Накладываем логотип в центр QR-кода
            await (0, sharp_1.default)(qrCodePath)
                .composite([
                {
                    input: logoBuffer,
                    top: Math.floor((qrSize - logoSize) / 2),
                    left: Math.floor((qrSize - logoSize) / 2)
                }
            ])
                .toFile(qrFinalPath);
            // Удаляем промежуточный файл
            fs.unlinkSync(qrCodePath);
            return qrFinalPath;
        }
        catch (error) {
            console.error('Error adding logo to QR code:', error);
            return qrCodePath; // fallback: возвращаем обычный QR
        }
    }
    return qrCodePath;
}
// Инициализация бота
const bot = new telegraf_1.Telegraf(process.env.BOT_TOKEN);
// Настройка меню команд
async function setupCommands() {
    try {
        await bot.telegram.setMyCommands([
            { command: 'start', description: '🚀 Запустить бота и показать приветствие' },
            { command: 'create', description: '🔄 Создать QR-код с логотипом' },
            { command: 'help', description: '📖 Показать справку по использованию бота' },
            { command: 'cancel', description: '❌ Отменить текущую операцию' }
        ]);
        console.log('Menu commands set successfully');
    }
    catch (error) {
        console.error('Error setting menu commands:', error);
    }
}
setupCommands();
// Очистка temp при запуске
cleanupTempFolder();
// Периодическая очистка temp каждые 6 часов
setInterval(cleanupTempFolder, 6 * 60 * 60 * 1000);
// Обработка команды /start
bot.command('start', async (ctx) => {
    const welcomeMessage = `
👋 Привет! Я бот для генерации QR-кодов.

📝 Как использовать:
1. Используйте команду /create или нажмите кнопку "Создать QR-код"
2. Выберите тип QR-кода: с логотипом или без
3. Если вы выбрали с логотипом - отправьте логотип в формате SVG
4. Отправьте ссылку
5. Получите готовый QR-код

🔍 Доступные команды:
/start - Запустить бота
/create - Создать QR-код
/help - Показать справку
/cancel - Отменить операцию
    `;
    await ctx.reply(welcomeMessage, telegraf_1.Markup.keyboard([
        ['🔄 Создать QR-код']
    ]).resize());
});
// Обработка команды /create
bot.command('create', async (ctx) => {
    const userId = ctx.from.id;
    userStates.set(userId, { awaitingChoice: true, awaitingLogo: false, awaitingUrl: false });
    await ctx.reply('Выбери тип QR-кода:', telegraf_1.Markup.keyboard([
        ['✅ С логотипом'],
        ['❌ Без логотипа'],
        ['🔙 Отменить']
    ]).resize());
});
// Обработка команды /cancel
bot.command('cancel', async (ctx) => {
    const userId = ctx.from.id;
    userStates.delete(userId);
    await ctx.reply('✅ Операция отменена.', telegraf_1.Markup.keyboard([
        ['🔄 Создать QR-код']
    ]).resize());
});
// Обработка команды /help
bot.command('help', async (ctx) => {
    const helpMessage = `
📝 Справка по использованию бота:

1. Нажмите кнопку "Создать QR-код" или команду /create
2. Выберите тип QR-кода: с логотипом или без
3. Если вы выбрали с логотипом - отправьте логотип в формате SVG
4. Отправьте ссылку или текст для QR-кода
5. Получите готовый QR-код

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
    userStates.set(userId, { awaitingChoice: true, awaitingLogo: false, awaitingUrl: false });
    await ctx.reply('Выбери тип QR-кода:', telegraf_1.Markup.keyboard([
        ['✅ С логотипом'],
        ['❌ Без логотипа'],
        ['🔙 Отменить']
    ]).resize());
});
// Обработка нажатия кнопки "С логотипом"
bot.hears('✅ С логотипом', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    if (state?.awaitingChoice) {
        state.awaitingChoice = false;
        state.awaitingLogo = true;
        state.awaitingUrl = false;
        userStates.set(userId, state);
        await ctx.reply('Отправь логотип в формате SVG.', telegraf_1.Markup.keyboard([
            ['🔙 Отменить']
        ]).resize());
    }
});
// Обработка нажатия кнопки "Без логотипа"
bot.hears('❌ Без логотипа', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    if (state?.awaitingChoice) {
        state.awaitingChoice = false;
        state.awaitingLogo = false;
        state.awaitingUrl = true;
        userStates.set(userId, state);
        await ctx.reply('Пришли ссылку или текст, который зашить в QR-код.', telegraf_1.Markup.keyboard([
            ['🔙 Отменить']
        ]).resize());
    }
});
// Обработка нажатия кнопки "Отменить"
bot.hears('🔙 Отменить', async (ctx) => {
    const userId = ctx.from.id;
    userStates.delete(userId);
    await ctx.reply('✅ Операция отменена.', telegraf_1.Markup.keyboard([
        ['🔄 Создать QR-код']
    ]).resize());
});
// Обработка получения фото
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    if (state?.awaitingLogo) {
        try {
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            const file = await ctx.telegram.getFile(photo.file_id);
            const logoPath = path.join(__dirname, 'temp', `logo_${Date.now()}.svg`);
            // Скачиваем логотип
            await downloadFile(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`, logoPath);
            state.logoPath = logoPath;
            state.awaitingLogo = false;
            state.awaitingUrl = true;
            userStates.set(userId, state);
            await ctx.reply('Теперь пришли ссылку или текст, который зашить в QR-код.', telegraf_1.Markup.keyboard([
                ['🔙 Отменить']
            ]).resize());
        }
        catch (error) {
            console.error('Error processing logo:', error);
            await ctx.reply('Произошла ошибка при обработке логотипа. Пожалуйста, попробуйте еще раз.');
        }
    }
});
// Обработка получения SVG-документа
bot.on('document', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    if (state?.awaitingLogo) {
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
            state.awaitingLogo = false;
            state.awaitingUrl = true;
            userStates.set(userId, state);
            await ctx.reply('Теперь пришли ссылку или текст, который зашить в QR-код.', telegraf_1.Markup.keyboard([
                ['🔙 Отменить']
            ]).resize());
        }
        catch (error) {
            console.error('Error processing SVG logo:', error);
            await ctx.reply('Произошла ошибка при обработке логотипа. Пожалуйста, попробуйте еще раз.');
        }
    }
});
// Обработка текстовых сообщений
bot.on((0, filters_1.message)('text'), async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    const text = ctx.message.text;
    if (state?.awaitingUrl) {
        let processedUrl;
        try {
            processedUrl = processUrl(text);
            new URL(processedUrl);
        }
        catch {
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
                    }
                    catch (error) {
                        console.error(`Ошибка при удалении файла ${qrCodePath}:`, error);
                    }
                }
            }, 5 * 60 * 1000);
            // Очищаем состояние пользователя
            userStates.delete(userId);
        }
        catch (error) {
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
