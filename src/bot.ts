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

// Интерфейс для настроек рендеринга
interface RenderSettings {
    roundedRadius: number;    // Скругление углов модулей (0 = квадраты)
    moduleStyle: 'square' | 'diamond' | 'circle'; // Стиль модулей
}

// Интерфейс для хранения состояния пользователя
interface UserState {
    awaitingChoice: boolean;  // ожидаем выбор между "С логотипом" или "Без логотипа"
    awaitingLogo: boolean;   // ожидаем логотип
    awaitingUrl: boolean;     // ожидаем ссылку
    awaitingQuality: boolean; // ожидаем выбор качества
    awaitingRenderSettings: boolean; // ожидаем настройки рендеринга
    logoPath?: string;
    quality?: 'standard' | 'high' | 'ultra';
    renderSettings?: RenderSettings; // Настройки рендеринга
}

// Хранилище состояний пользователей
const userStates = new Map<number, UserState>();

// Предустановленные настройки рендеринга
const renderSettingsPresets: Record<string, RenderSettings> = {
    'Квадраты': { roundedRadius: 0, moduleStyle: 'square' },
    'Скругленные': { roundedRadius: 8, moduleStyle: 'square' },
    'Круглые': { roundedRadius: 0, moduleStyle: 'circle' }
};

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
async function generateQRWithLogo(
    url: string, 
    logoPath?: string, 
    quality: 'standard' | 'high' | 'ultra' = 'high',
    renderSettings?: RenderSettings
): Promise<string> {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
    }
    const unique = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const qrCodePath = path.join(tempDir, `${unique}_qr.png`);
    const qrFinalPath = path.join(tempDir, `${unique}_qr_final.png`);

    // Настройки качества
    const qualitySettings = {
        standard: { qrSize: 400, margin: 20, logoSize: 100, padding: 25 },
        high: { qrSize: 800, margin: 40, logoSize: 200, padding: 50 },
        ultra: { qrSize: 1600, margin: 80, logoSize: 400, padding: 100 }
    };

    const settings = qualitySettings[quality];
    const { qrSize, margin, logoSize, padding } = settings;
    const whiteCircleRadius = (logoSize + padding * 2) / 2;
    
    // Применяем настройки рендеринга или используем значения по умолчанию
    const roundedRadius = renderSettings?.roundedRadius ?? 0;
    const moduleStyle = renderSettings?.moduleStyle ?? 'square';

    // Получаем матрицу QR-кода через низкоуровневый API
    const qr = qrcode.create(url, {
        errorCorrectionLevel: 'H'
    });

    const moduleCount = qr.modules.size;
    
    // Размер QR-кода без margin (внутренняя область)
    const qrContentSize = qrSize - (margin * 2);
    
    // Создаем SVG с модифицированной матрицей (без паттернов в центре)
    let svgString = `<svg width="${qrSize}" height="${qrSize}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" image-rendering="crisp-edges">`;
    
    // Добавляем белый фон
    svgString += `<rect x="0" y="0" width="${qrSize}" height="${qrSize}" fill="#ffffff"/>`;
    
    const cellSize = qrContentSize / moduleCount;
    const centerX = moduleCount / 2;
    const centerY = moduleCount / 2;

    // Функция для рендеринга модуля
    function renderModule(x: number, y: number, isDark: boolean, color: string): string {
        if (moduleStyle === 'circle') {
            // Круглые модули
            const radius = cellSize / 2 * 0.9; // 90% размера для красоты
            return `<circle cx="${x + cellSize / 2}" cy="${y + cellSize / 2}" r="${radius}" fill="${color}"/>`;
        } else {
            // Квадратные модули (с опциональным скруглением)
            return `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="${roundedRadius}" ry="${roundedRadius}" fill="${color}"/>`;
        }
    }

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
                svgString += renderModule(x, y, false, '#ffffff');
            } else {
                svgString += renderModule(x, y, false, isDark ? '#000000' : '#ffffff');
            }
        }
    }
    svgString += '</svg>';

    // Конвертируем SVG в PNG с высоким качеством
    const svgBuffer = Buffer.from(svgString);
    const pngBuffer = await sharp(svgBuffer)
        .png({ 
            quality: 100, 
            compressionLevel: 0,
            adaptiveFiltering: false,
            force: true
        })
        .toBuffer();
    fs.writeFileSync(qrCodePath, pngBuffer);

    // Если есть логотип, накладываем его
    if (logoPath) {
        try {
            let logoBuffer: Buffer;
            if (logoPath.endsWith('.svg')) {
                const svgBuffer = fs.readFileSync(logoPath);
                logoBuffer = await svg2png(svgBuffer, { width: logoSize, height: logoSize });
            } else {
                logoBuffer = fs.readFileSync(logoPath);
            }

            // Накладываем логотип в центр QR-кода с высоким качеством
            await sharp(qrCodePath)
                .composite([
                    {
                        input: logoBuffer,
                        top: Math.floor((qrSize - logoSize) / 2),
                        left: Math.floor((qrSize - logoSize) / 2)
                    }
                ])
                .png({ 
                    quality: 100, 
                    compressionLevel: 0,
                    adaptiveFiltering: false,
                    force: true
                })
                .toFile(qrFinalPath);

            // Удаляем промежуточный файл
            fs.unlinkSync(qrCodePath);
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

// Настройка меню команд
async function setupCommands() {
    try {
        await bot.telegram.setMyCommands([
            { command: 'start', description: '🚀 Запустить бота и показать приветствие' },
            { command: 'create', description: '🔄 Создать высококачественный QR-код' },
            { command: 'help', description: '📖 Показать справку по использованию бота' },
            { command: 'cancel', description: '❌ Отменить текущую операцию' }
        ]);
        console.log('Menu commands set successfully');
    } catch (error) {
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
👋 Привет! Я бот для генерации высококачественных QR-кодов.

📝 Как использовать:
1. Используйте команду /create или нажмите кнопку "Создать QR-код"
2. Выберите стиль модулей: квадраты, скругленные или круглые
3. Выберите качество: стандартное, высокое или ультра
4. Выберите тип QR-кода: с логотипом или без
5. Если вы выбрали с логотипом - отправьте логотип в формате SVG
6. Отправьте ссылку
7. Получите готовый высококачественный QR-код

✨ Особенности:
- Различные стили модулей (квадраты, скругленные, круглые)
- Поддержка разных уровней качества (до 1600x1600px)
- Четкие края без размытия
- Оптимизированное качество изображения

🔍 Доступные команды:
/start - Запустить бота
/create - Создать высококачественный QR-код
/help - Показать справку
/cancel - Отменить операцию
    `;

    await ctx.reply(welcomeMessage, Markup.keyboard([
        ['🔄 Создать QR-код']
    ]).resize());
});

// Обработка команды /create
bot.command('create', async (ctx) => {
    const userId = ctx.from.id;
    userStates.set(userId, { awaitingChoice: false, awaitingLogo: false, awaitingUrl: false, awaitingQuality: false, awaitingRenderSettings: true });

    await ctx.reply(
        'Выбери стиль модулей QR-кода:',
        Markup.keyboard([
            ['Квадраты', 'Скругленные'],
            ['Круглые'],
            ['🔙 Отменить']
        ]).resize()
    );
});

// Обработка команды /cancel
bot.command('cancel', async (ctx) => {
    const userId = ctx.from.id;
    userStates.delete(userId);

    await ctx.reply(
        '✅ Операция отменена.',
        Markup.keyboard([
            ['🔄 Создать QR-код']
        ]).resize()
    );
});

// Обработка команды /help
bot.command('help', async (ctx) => {
    const helpMessage = `
📝 Справка по использованию бота:

1. Нажмите кнопку "Создать QR-код" или команду /create
2. Выберите стиль модулей: Квадраты, Скругленные или Круглые
3. Выберите качество: стандартное (400px), высокое (800px) или ультра (1600px)
4. Выберите тип QR-кода: с логотипом или без
5. Если вы выбрали с логотипом - отправьте логотип в формате SVG
6. Отправьте ссылку или текст для QR-кода
7. Получите готовый высококачественный QR-код

✨ Стили модулей:
- Квадраты: классические угловатые модули
- Скругленные: квадраты со скругленными углами
- Круглые: круглые модули

✨ Уровни качества:
- 📱 Стандартное: 400x400px, быстрое создание
- 🖥️ Высокое: 800x800px, оптимальное качество
- 🎨 Ультра: 1600x1600px, максимальное качество

⚠️ Ограничения:
- Максимальная длина ссылки: 2048 символов
- Поддерживаются только текстовые ссылки
- Логотип должен быть в формате SVG
- Ультра качество может занимать больше времени
    `;

    await ctx.reply(helpMessage);
});

// Обработка нажатия кнопки "Создать QR-код"
bot.hears('🔄 Создать QR-код', async (ctx) => {
    const userId = ctx.from.id;
    userStates.set(userId, { awaitingChoice: false, awaitingLogo: false, awaitingUrl: false, awaitingQuality: false, awaitingRenderSettings: true });

    await ctx.reply(
        'Выбери стиль модулей QR-кода:',
        Markup.keyboard([
            ['Квадраты', 'Скругленные'],
            ['Круглые'],
            ['🔙 Отменить']
        ]).resize()
    );
});

// Обработка выбора стиля рендеринга
bot.hears('Квадраты', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    
    if (state?.awaitingRenderSettings) {
        state.renderSettings = renderSettingsPresets['Квадраты'];
        state.awaitingRenderSettings = false;
        state.awaitingQuality = true;
        userStates.set(userId, state);

        await ctx.reply(
            'Выбери качество QR-кода:',
            Markup.keyboard([
                ['📱 Стандартное (400px)', '🖥️ Высокое (800px)'],
                ['🎨 Ультра (1600px)'],
                ['🔙 Отменить']
            ]).resize()
        );
    }
});

bot.hears('Скругленные', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    
    if (state?.awaitingRenderSettings) {
        state.renderSettings = renderSettingsPresets['Скругленные'];
        state.awaitingRenderSettings = false;
        state.awaitingQuality = true;
        userStates.set(userId, state);

        await ctx.reply(
            'Выбери качество QR-кода:',
            Markup.keyboard([
                ['📱 Стандартное (400px)', '🖥️ Высокое (800px)'],
                ['🎨 Ультра (1600px)'],
                ['🔙 Отменить']
            ]).resize()
        );
    }
});

bot.hears('Круглые', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    
    if (state?.awaitingRenderSettings) {
        state.renderSettings = renderSettingsPresets['Круглые'];
        state.awaitingRenderSettings = false;
        state.awaitingQuality = true;
        userStates.set(userId, state);

        await ctx.reply(
            'Выбери качество QR-кода:',
            Markup.keyboard([
                ['📱 Стандартное (400px)', '🖥️ Высокое (800px)'],
                ['🎨 Ультра (1600px)'],
                ['🔙 Отменить']
            ]).resize()
        );
    }
});

// Обработка выбора качества
bot.hears('📱 Стандартное (400px)', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    
    if (state?.awaitingQuality) {
        state.awaitingQuality = false;
        state.awaitingChoice = true;
        state.quality = 'standard';
        userStates.set(userId, state);

        await ctx.reply(
            'Выбери тип QR-кода:',
            Markup.keyboard([
                ['✅ С логотипом'],
                ['❌ Без логотипа'],
                ['🔙 Отменить']
            ]).resize()
        );
    }
});

bot.hears('🖥️ Высокое (800px)', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    
    if (state?.awaitingQuality) {
        state.awaitingQuality = false;
        state.awaitingChoice = true;
        state.quality = 'high';
        userStates.set(userId, state);

        await ctx.reply(
            'Выбери тип QR-кода:',
            Markup.keyboard([
                ['✅ С логотипом'],
                ['❌ Без логотипа'],
                ['🔙 Отменить']
            ]).resize()
        );
    }
});

bot.hears('🎨 Ультра (1600px)', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    
    if (state?.awaitingQuality) {
        state.awaitingQuality = false;
        state.awaitingChoice = true;
        state.quality = 'ultra';
        userStates.set(userId, state);

        await ctx.reply(
            'Выбери тип QR-кода:',
            Markup.keyboard([
                ['✅ С логотипом'],
                ['❌ Без логотипа'],
                ['🔙 Отменить']
            ]).resize()
        );
    }
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

        await ctx.reply(
            'Отправь логотип в формате SVG.',
            Markup.keyboard([
                ['🔙 Отменить']
            ]).resize()
        );
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

        const qualityText = state.quality === 'ultra' ? 'ультра' : 
                           state.quality === 'high' ? 'высоком' : 'стандартном';
        
        await ctx.reply(
            `Пришли ссылку или текст для QR-кода в ${qualityText} качестве.`,
            Markup.keyboard([
                ['🔙 Отменить']
            ]).resize()
        );
    }
});

// Обработка нажатия кнопки "Отменить"
bot.hears('🔙 Отменить', async (ctx) => {
    const userId = ctx.from.id;
    userStates.delete(userId);

    await ctx.reply(
        '✅ Операция отменена.',
        Markup.keyboard([
            ['🔄 Создать QR-код']
        ]).resize()
    );
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

            const qualityText = state.quality === 'ultra' ? 'ультра' : 
                               state.quality === 'high' ? 'высоком' : 'стандартном';
            
            await ctx.reply(
                `Теперь пришли ссылку или текст для QR-кода в ${qualityText} качестве.`,
                Markup.keyboard([
                    ['🔙 Отменить']
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

            const qualityText = state.quality === 'ultra' ? 'ультра' : 
                               state.quality === 'high' ? 'высоком' : 'стандартном';
            
            await ctx.reply(
                `Теперь пришли ссылку или текст для QR-кода в ${qualityText} качестве.`,
                Markup.keyboard([
                    ['🔙 Отменить']
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

    if (state?.awaitingUrl) {
        let processedUrl: string;
        try {
            processedUrl = processUrl(text);
            new URL(processedUrl);
        } catch {
            await ctx.reply('Пожалуйста, отправьте корректную ссылку!');
            return;
        }

        try {
            const quality = state.quality || 'high';
            const renderSettings = state.renderSettings;
            const qrCodePath = await generateQRWithLogo(processedUrl, state.logoPath, quality, renderSettings);
            
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