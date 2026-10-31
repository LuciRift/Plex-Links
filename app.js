const express = require('express');
const { client } = require("./index.js")
const path = require('path');
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const color = require('ansi-colors');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const multer = require('multer');
const botVersion = require('./package.json');
const UAParser = require('ua-parser-js');
const rateLimit = require('express-rate-limit');

const settingsModel = require('./models/settingsModel')
const linkModel = require('./models/linkModel')

function parseDuration(input) {
    if (typeof input === 'number') {
        return input;
    }

    if (typeof input !== 'string') {
        throw new Error('Duration must be a string or number');
    }

    const units = {
        ms: 1,
        s: 1000,
        sec: 1000,
        second: 1000,
        seconds: 1000,
        m: 60000,
        min: 60000,
        minute: 60000,
        minutes: 60000,
        h: 3600000,
        hr: 3600000,
        hour: 3600000,
        hours: 3600000,
        d: 86400000,
        day: 86400000,
        days: 86400000,
        w: 604800000,
        week: 604800000,
        weeks: 604800000,
        y: 31536000000,
        year: 31536000000,
        years: 31536000000
    };

    const regex = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/;
    const match = input.trim().match(regex);

    if (!match) {
        throw new Error(`Invalid duration format: ${input}`);
    }

    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();

    if (!(unit in units)) {
        throw new Error(`Unknown time unit: ${unit}`);
    }

    return Math.round(value * units[unit]);
}

const app = express();

const uploadDir = path.join(__dirname, './uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    if (file.size > 5 * 1024 * 1024) {
        return cb(new Error('File too large'), false);
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/x-icon'];
    if (!allowedTypes.includes(file.mimetype)) {
        return cb(new Error('Invalid file type'), false);
    }

    cb(null, true);
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
});

const connectToMongoDB = async () => {
    try {
        if (config.MongoURI) await mongoose.set('strictQuery', false);

        if (config.MongoURI) {
            await mongoose.connect(config.MongoURI);
        } else {
            throw new Error('[ERROR] MongoDB Connection String is not specified in the config! (MongoURI)');
        }
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', `[ERROR] Failed to connect to MongoDB: ${error.message}\n${error.stack}`);

        if (error.message.includes('authentication failed')) {
            await console.error('Authentication failed. Make sure to check if you entered the correct username and password in the connection URL.');
            await process.exit(1)
        } else if (error.message.includes('network error')) {
            await console.error('Network error. Make sure the MongoDB server is reachable and the connection URL is correct.');
            await process.exit(1)
        } else if (error.message.includes('permission denied')) {
            await console.error('Permission denied. Make sure the MongoDB cluster has the necessary permissions to read and write.');
            await process.exit(1)
        } else {
            await console.error('An unexpected error occurred. Check the MongoDB connection URL and credentials.');
            await process.exit(1)
        }
    }
};
connectToMongoDB();

const createSettings = async () => {
    let settings = await settingsModel.findOne();
    if (!settings) {
        settings = new settingsModel();
        await settings.save();
    }
}
createSettings()

if (config?.trustProxy) app.set('trust proxy', 1);

app.use(session({
    secret: config.secretKey,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: config.MongoURI,
        ttl: parseDuration(config.SessionExpires),
        autoRemove: 'native'
    }),

    cookie: {
        secure: config.Secure,
        maxAge: parseDuration(config.SessionExpires)
    }
}));

app.use(cookieParser());
app.use(passport.initialize());
app.use(passport.session());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const slugRateLimiter = config.RateLimit?.enabled ? rateLimit({
    windowMs: parseDuration(config.RateLimit.windowMs),
    max: config.RateLimit.max,
    message: {
        error: config.RateLimit.message,
        retryAfter: Math.ceil(parseDuration(config.RateLimit.windowMs) / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.log(`Rate limit exceeded for IP: ${req.ip} on slug: ${req.params.slug}`);
        res.status(429).json({
            error: config.RateLimit.message,
            retryAfter: Math.ceil(parseDuration(config.RateLimit.windowMs) / 1000)
        });
    }
}) : (req, res, next) => next();

async function loadSettings(req, res, next) {
    try {
        const settings = await settingsModel.findOne();
        if (!settings) return next(new Error('Settings not found'));

        res.locals.settings = settings;
        res.locals.config = config;

        req.isStaff = function () {
            if (!req.user || !req.user.id) return false;
            return config.OwnerID.includes(req.user.id);
        };

        res.locals.isStaff = req.isStaff();

        next();
    } catch (err) {
        next(err);
    }
}

app.use(loadSettings);

app.use((req, res, next) => {
    const send = res.send;
    res.send = function (body) {
        if (typeof body === 'string' && body.includes('</body>')) {
            const consoleScript = `
                <script>
                    (function() {
                        const message = \`
%c
Plex Links is made by Plex Development.
Version: ${botVersion.version}
Buy - https://plexdevelopment.net/products/plexlinks
\`,
                            style = \`
font-family: monospace;
color: #5e99ff;
background-color: #1e1e1e;
padding: 10px;
border: 1px solid #00aaff;
\`;
        
                        console.log(message, style);
                    })();
                </script>
                `;
            body = body.replace('</body>', consoleScript + '</body>');
        }
        send.call(this, body);
    };
    next();
});

function checkStaffAccess(req, res, next) {
    if (req.isStaff()) {
        next();
    } else {
        if (req.isAuthenticated()) {
            req.logout((err) => {
                res.redirect('/login');
            });
        } else {
            res.redirect('/login');
        }
    }
}

passport.use(new DiscordStrategy(
    {
        clientID: config.clientID,
        clientSecret: config.clientSecret,
        callbackURL: config.callbackURL,
        scope: ['identify'],
    },
    async (accessToken, refreshToken, profile, done) => {
        try {
            return done(null, profile);
        } catch (err) {
            return done(err, null);
        }
    }
));

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});


const isLoggedIn = async (req, res, next) => {
    if (req.isAuthenticated()) {
        next();
    } else {
        res.redirect(`/login`);
    }
};

function hexToRgb(hex) {
    hex = hex.replace('#', '');
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);
    return `${r}, ${g}, ${b}`;
}

async function getAccentColor() {
    const settings = await settingsModel.findOne();
    const hexColor = settings.accentColor
    const rgbColor = hexToRgb(hexColor);
    return { hex: hexColor, rgb: rgbColor };
}

app.use(async (req, res, next) => {
    try {
        const { hex, rgb } = await getAccentColor();
        res.locals.accentColorHex = hex;
        res.locals.accentColorRgb = rgb;
        next();
    } catch (error) {
        console.error('Failed to fetch accent colors:', error.message);
        next();
    }
});

app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/login' }), (req, res) => {
    if (req.isStaff()) {
        res.redirect('/home');
    } else {
        req.logout((err) => {
            res.redirect('/login');
        });
    }
});
app.get('/auth', passport.authenticate('discord'));

app.get('/staff', isLoggedIn, checkStaffAccess, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 12;
        const skip = (page - 1) * limit;
        
        const [links, totalLinks, totalClicks] = await Promise.all([
            linkModel.find({ isActive: true })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            linkModel.countDocuments({ isActive: true }),
            linkModel.aggregate([
                { $match: { isActive: true } },
                { $group: { _id: null, totalClicks: { $sum: '$clicks' } } }
            ])
        ]);
        
        const totalPages = Math.ceil(totalLinks / limit);
        const settings = await settingsModel.findOne();

        res.render('staff', {
            user: req.user,
            links,
            settings,
            host: req.get('host'),
            totalStats: {
                totalLinks,
                totalClicks: totalClicks[0]?.totalClicks || 0
            },
            pagination: {
                currentPage: page,
                totalPages,
                totalLinks,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
                nextPage: page + 1,
                prevPage: page - 1
            }
        });
    } catch (error) {
        console.error('Error loading staff panel:', error);
        res.status(500).send('Error loading staff panel');
    }
});

app.post('/staff/links/create', isLoggedIn, checkStaffAccess, async (req, res) => {
    try {
        
        const { slug, originalUrl } = req.body;
        
        if (!slug || !originalUrl) {
            console.log('Missing data - slug:', slug, 'originalUrl:', originalUrl);
            return res.status(400).send('Slug and original URL are required');
        }
        
        if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
            return res.status(400).send('Slug can only contain letters, numbers, hyphens, and underscores');
        }
        
        if (!/^https?:\/\/.+/.test(originalUrl)) {
            return res.status(400).send('Please enter a valid URL starting with http:// or https://');
        }
        
        const existingLink = await linkModel.findOne({ slug: slug.toLowerCase() });
        if (existingLink) {
            return res.status(400).send('This slug is already taken');
        }
        
        const newLink = new linkModel({
            slug: slug.toLowerCase(),
            originalUrl,
            createdBy: req.user.id,
            createdByUsername: req.user.username
        });
        
        await newLink.save();
        res.status(200).send('Link created successfully');
        
    } catch (error) {
        console.error('Error creating link:', error);
        res.status(500).send('Failed to create link');
    }
});

app.get('/staff/links/:id', isLoggedIn, checkStaffAccess, async (req, res) => {
    try {
        const link = await linkModel.findById(req.params.id);
        
        if (!link) {
            return res.status(404).json({ error: 'Link not found' });
        }
        
        res.json(link);
    } catch (error) {
        console.error('Error fetching link:', error);
        res.status(500).json({ error: 'Failed to fetch link' });
    }
});

app.post('/staff/links/edit/:id', isLoggedIn, checkStaffAccess, async (req, res) => {
    try {
        const { originalUrl } = req.body;
        
        if (!originalUrl) {
            return res.status(400).send('Original URL is required');
        }
        
        if (!/^https?:\/\/.+/.test(originalUrl)) {
            return res.status(400).send('Please enter a valid URL starting with http:// or https://');
        }
        
        const link = await linkModel.findById(req.params.id);
        
        if (!link) {
            return res.status(404).send('Link not found');
        }
        
        link.originalUrl = originalUrl
        
        await link.save();
        res.status(200).send('Link updated successfully');
        
    } catch (error) {
        console.error('Error updating link:', error);
        res.status(500).send('Failed to update link');
    }
});

app.delete('/staff/links/delete/:id', isLoggedIn, checkStaffAccess, async (req, res) => {
    try {
        const link = await linkModel.findById(req.params.id);
        
        if (!link) {
            return res.status(404).send('Link not found');
        }
        
        await linkModel.findByIdAndDelete(req.params.id);
        
        res.status(200).send('Link deleted successfully');
    } catch (error) {
        console.error('Error deleting link:', error);
        res.status(500).send('Failed to delete link');
    }
});

app.get('/home', isLoggedIn, checkStaffAccess, async (req, res) => {
    try {
        const [recentLinks, totalLinksResult, totalClicksResult, todayClicksResult] = await Promise.all([
            linkModel.find()
                .sort({ createdAt: -1 })
                .limit(8)
                .select('slug originalUrl clicks createdAt'),
            linkModel.countDocuments(),
            linkModel.getTotalClicks(),
            linkModel.getTodayClicks()
        ]);
        
        const topLink = await linkModel.findOne()
            .sort({ clicks: -1 })
            .select('clicks');
        
        const stats = {
            totalLinks: totalLinksResult,
            totalClicks: totalClicksResult[0]?.totalClicks || 0,
            todayClicks: todayClicksResult[0]?.todayClicks || 0,
            topLink: topLink?.clicks || 0
        };
        
        res.render('home', {
            user: req.user,
            links: recentLinks,
            stats,
            host: req.get('host')
        });
    } catch (error) {
        console.error('Error loading home page:', error);
        res.status(500).send('Error loading dashboard');
    }
});

app.post('/settings', upload.fields([{ name: 'logo' }, { name: 'favicon' }]), isLoggedIn, checkStaffAccess, async (req, res) => {
    const { accentColor, websiteName, redirectDelayEnabled, redirectDelaySeconds } = req.body;

    try {
        let settings = await settingsModel.findOne();
        if (!settings) settings = new settingsModel();

        settings.accentColor = accentColor || settings.accentColor;
        settings.name = websiteName || settings.name;
        
        settings.redirectDelay = {
            enabled: redirectDelayEnabled === 'on',
            seconds: parseInt(redirectDelaySeconds) || 5
        };

        if (req.files.logo) {
            settings.logo = `/uploads/${req.files.logo[0].filename}`;
        }
        if (req.files.favicon) {
            settings.favicon = `/uploads/${req.files.favicon[0].filename}`;
        }

        settings.updatedAt = Date.now();
        await settings.save();

        res.redirect('/staff');
    } catch (error) {
        console.error('Error saving settings:', error.message);
        res.status(500).send('An error occurred while saving the settings.');
    }
});

app.get('/analytics', isLoggedIn, checkStaffAccess, async (req, res) => {
    try {
        res.render('analytics', {
            user: req.user,
        });
    } catch (error) {
        console.error('Error loading analytics page:', error);
        res.status(500).send('Error loading analytics');
    }
});

app.get('/api/analytics', isLoggedIn, checkStaffAccess, async (req, res) => {
    try {
        const [
            overallStats,
            topLinks,
            topCountries,
            topReferrers,
            deviceStats,
            browserStats,
            dailyClicks,
            todayClicks
        ] = await Promise.all([
            linkModel.getOverallStats(),
            linkModel.getTopLinks(10, 9999),
            linkModel.getTopCountries(10),
            linkModel.getTopReferrers(10),
            linkModel.getDeviceStats(),
            linkModel.getBrowserStats(),
            linkModel.getDailyClicksData(30),
            linkModel.getTodayClicks()
        ]);

        const stats = {
            totalLinks: overallStats[0]?.totalLinks || 0,
            totalClicks: overallStats[0]?.totalClicks || 0,
            uniqueVisitors: overallStats[0]?.totalUniqueVisitors || 0,
            todayClicks: todayClicks[0]?.todayClicks || 0,
            avgClicksPerLink: overallStats[0]?.averageClicksPerLink || 0
        };

        const hourlyData = await linkModel.getHourlyDistribution();

        const currentHost = req.get('host');

        res.json({
            stats,
            topLinks: topLinks.map(link => ({
                slug: link.slug,
                originalUrl: link.originalUrl,
                clicks: link.clicks
            })),
            topCountries: topCountries.map(country => ({
                country: country._id,
                clicks: country.totalClicks
            })),
            topReferrers: topReferrers
                .filter(ref => ref._id !== 'Direct' && ref._id !== currentHost)
                .map(ref => ({
                    domain: ref._id,
                    clicks: ref.totalClicks
                })),
            deviceStats: deviceStats.map(device => ({
                type: device._id,
                clicks: device.totalClicks
            })),
            topBrowsers: browserStats.map(browser => ({
                name: browser._id,
                clicks: browser.totalClicks
            })),
            dailyClicks: dailyClicks,
            hourlyData: hourlyData
        });
    } catch (error) {
        console.error('Error fetching analytics data:', error);
        res.status(500).json({ error: 'Failed to fetch analytics data' });
    }
});

app.get('/', (req, res) => {
    if (req.isAuthenticated()) {
        if (req.isStaff()) {
            res.redirect('/home');
        } else {
            req.logout((err) => {
                res.redirect('/login');
            });
        }
    } else {
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.get('/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            console.error('Error during logout:', err);
            return next(err);
        }
        res.redirect('/');
    });
});

async function getLocationData(ip) {
    try {
        if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
            return { country: 'Local', city: 'Local' };
        }
        
        const response = await axios.get(`http://ip-api.com/json/${ip}`, { timeout: 3000 });
        if (response.data.status === 'success') {
            return {
                country: response.data.country || 'Unknown',
                city: response.data.city || 'Unknown'
            };
        }
    } catch (error) {
        console.error('Error fetching location data:', error.message);
    }
    return { country: 'Unknown', city: 'Unknown' };
}

function parseUserAgent(userAgent) {
    const parser = new UAParser(userAgent);
    const result = parser.getResult();
    
    return {
        device: result.device.type || 'desktop',
        browser: {
            name: result.browser.name || 'Unknown',
            version: result.browser.version || ''
        },
        os: {
            name: result.os.name || 'Unknown',
            version: result.os.version || ''
        }
    };
}

app.get('/:slug', slugRateLimiter, async (req, res) => {
    try {
        const slug = req.params.slug.toLowerCase().trim();
        
        const ignoredSlugs = [
            'favicon.ico', 
            'robots.txt', 
            'sitemap.xml', 
            'logo.png',
            'apple-touch-icon.png',
            'manifest.json',
            '.well-known'
        ];
        
        if (ignoredSlugs.includes(slug) || slug.startsWith('.')) {
            return res.status(404).end();
        }
        
        const settings = await settingsModel.findOne();
        const link = await linkModel.findOne({ slug });
        if (!link) {
            return res.status(404).render('404', {
                settings
            });
        }
        
        const originalUrl = link.originalUrl;
        
        if (req.method === 'HEAD') {
            return res.status(200).end();
        }
        
        if (settings?.redirectDelay?.enabled) {
            return res.render('redirect', {
                settings,
                destination: originalUrl,
                seconds: settings.redirectDelay.seconds || 5
            });
        }

        const requestId = `${req.ip}-${Date.now()}-${Math.random()}`;
        
        setImmediate(async () => {
            try {
                const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
                const userAgent = req.get('User-Agent') || '';
                const referer = req.get('Referer') || 'Direct';
                
                const botPatterns = [
                    'bot', 'crawl', 'spider', 'scrape', 'facebook', 'twitter',
                    'linkedin', 'whatsapp', 'telegram', 'slack', 'discord'
                ];
                
                const isBot = botPatterns.some(pattern => 
                    userAgent.toLowerCase().includes(pattern)
                );
                
                if (isBot) {
                    console.log(`Skipping bot request: ${userAgent}`);
                    return;
                }
                
                const { device, browser, os } = parseUserAgent(userAgent);
                const { country, city } = await getLocationData(clientIP);
                
                const analyticsData = {
                    ip: clientIP,
                    referer: referer,
                    country: country,
                    city: city,
                    device: device,
                    browser: browser,
                    os: os,
                    userAgent: userAgent,
                    requestId: requestId
                };
                
                await link.addClick(analyticsData);
                
            } catch (analyticsError) {
                console.error('Analytics tracking failed:', analyticsError.message);
            }
        });
        
        res.redirect(301, originalUrl);
        
    } catch (error) {
        console.error('Error processing redirect:', error);
        
        try {
            const link = await linkModel.findOne({ 
                slug: req.params.slug.toLowerCase().trim(), 
            });
            if (link) {
                return res.redirect(301, link.originalUrl);
            }
        } catch (fallbackError) {
            console.error('Fallback redirect failed:', fallbackError);
        }
        
        res.status(500).send('Server error');
    }
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something went wrong!');
});

const cleanupInactiveLinks = async () => {
    try {
        await linkModel.deleteMany({ isActive: false });
    } catch (error) {
        console.error('Error cleaning up inactive links:', error);
    }
};

app.listen(config.Port, async () => {
    cleanupInactiveLinks()

    console.log("――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――");
    console.log("                                                                          ");
    if (config.LicenseKey) console.log(`${color.green.bold.underline(`Plex Links v${botVersion.version} is now Online!`)} (${color.gray(`${config.LicenseKey.slice(0, -10)}`)})`);
    if (!config.LicenseKey) console.log(`${color.green.bold.underline(`Plex Links v${botVersion.version} is now Online! `)}`);
    console.log(`• Join our discord server for support, ${color.cyan(`discord.gg/plexdev`)}`);
    console.log(`• Documentation can be found here, ${color.cyan(`docs.plexdevelopment.net`)}`);
    console.log(`• By using this product you agree to all terms located here, ${color.yellow(`plexdevelopment.net/tos`)}`);
    if (config.LicenseKey) console.log("                                                                          ");
    if (config.LicenseKey) console.log(`${color.green.bold.underline(`Source Code:`)}`);
    if (config.LicenseKey) console.log(`• You can buy the full source code at ${color.yellow(`plexdevelopment.net/products/plsourcecode`)}`);
    if (config.LicenseKey) console.log(`• Use code ${color.green.bold.underline(`PLEX`)} for 10% OFF!`);
    console.log("                                                                          ");
    console.log("――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――");
    console.log(color.yellow("[DASHBOARD] ") + `Web Server has started and is accessible with port ${color.yellow(`${config.Port}`)}`)
});