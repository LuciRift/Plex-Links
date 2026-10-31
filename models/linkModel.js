const mongoose = require('mongoose');

const linkSchema = new mongoose.Schema({
    slug: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        minlength: 1,
        maxlength: 100,
        index: true
    },
    originalUrl: {
        type: String,
        required: true,
        trim: true
    },
    createdBy: {
        type: String,
        required: true
    },
    createdByUsername: {
        type: String,
        required: true
    },
    clicks: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastClickedAt: {
        type: Date,
        default: null
    },
    
    analytics: {
        referrers: [{
            domain: { type: String, required: true },
            count: { type: Number, default: 1 },
            lastSeen: { type: Date, default: Date.now }
        }],
        
        countries: [{
            country: { type: String, required: true },
            count: { type: Number, default: 1 },
            lastSeen: { type: Date, default: Date.now }
        }],
        
        cities: [{
            city: { type: String, required: true },
            country: { type: String, required: true },
            count: { type: Number, default: 1 },
            lastSeen: { type: Date, default: Date.now }
        }],
        
        devices: [{
            type: { type: String, required: true },
            count: { type: Number, default: 1 },
            lastSeen: { type: Date, default: Date.now }
        }],
        
        browsers: [{
            name: { type: String, required: true },
            version: { type: String, default: '' },
            count: { type: Number, default: 1 },
            lastSeen: { type: Date, default: Date.now }
        }],
        
        operatingSystems: [{
            name: { type: String, required: true },
            version: { type: String, default: '' },
            count: { type: Number, default: 1 },
            lastSeen: { type: Date, default: Date.now }
        }],
        
        hourlyDistribution: {
            type: Map,
            of: Number,
            default: () => {
                const hours = {};
                for (let i = 0; i < 24; i++) {
                    hours[i] = 0;
                }
                return hours;
            }
        },
        
        dailyClicks: [{
            date: { type: Date, required: true },
            count: { type: Number, default: 1 }
        }],
        
        monthlyClicks: [{
            month: { type: String, required: true },
            count: { type: Number, default: 1 }
        }],
        
        uniqueIPs: [{
            ip: { type: String, required: true },
            firstSeen: { type: Date, default: Date.now },
            lastSeen: { type: Date, default: Date.now },
            clickCount: { type: Number, default: 1 }
        }],
        
        peakHour: {
            hour: { type: Number, default: 0 },
            count: { type: Number, default: 0 }
        },
        
        peakDay: {
            date: { type: Date, default: Date.now },
            count: { type: Number, default: 0 }
        },
        
        averageClicksPerDay: { type: Number, default: 0 },
        totalUniqueVisitors: { type: Number, default: 0 }
    }
}, {
    timestamps: true
});

linkSchema.index({ createdBy: 1 });
linkSchema.index({ createdAt: -1 });
linkSchema.index({ clicks: -1 });
linkSchema.index({ 'analytics.dailyClicks.date': 1 });
linkSchema.index({ 'analytics.uniqueIPs.ip': 1 });

linkSchema.methods.addClick = function(analyticsData = {}) {
    return new Promise(async (resolve, reject) => {
        try {
            
            const now = new Date();
            const currentHour = now.getHours();
            
            this.clicks += 1;
            this.lastClickedAt = now;
            
            if (!this.analytics || typeof this.analytics !== 'object') {
                this.analytics = {};
            }
            
            if (!Array.isArray(this.analytics.referrers)) this.analytics.referrers = [];
            if (!Array.isArray(this.analytics.countries)) this.analytics.countries = [];
            if (!Array.isArray(this.analytics.cities)) this.analytics.cities = [];
            if (!Array.isArray(this.analytics.devices)) this.analytics.devices = [];
            if (!Array.isArray(this.analytics.browsers)) this.analytics.browsers = [];
            if (!Array.isArray(this.analytics.operatingSystems)) this.analytics.operatingSystems = [];
            if (!Array.isArray(this.analytics.dailyClicks)) this.analytics.dailyClicks = [];
            if (!Array.isArray(this.analytics.monthlyClicks)) this.analytics.monthlyClicks = [];
            if (!Array.isArray(this.analytics.uniqueIPs)) this.analytics.uniqueIPs = [];
            
            if (!this.analytics.hourlyDistribution || !(this.analytics.hourlyDistribution instanceof Map)) {
                this.analytics.hourlyDistribution = new Map();
                for (let i = 0; i < 24; i++) {
                    this.analytics.hourlyDistribution.set(i.toString(), 0);
                }
            }
            
            if (!this.analytics.peakHour) this.analytics.peakHour = { hour: 0, count: 0 };
            if (!this.analytics.peakDay) this.analytics.peakDay = { date: new Date(), count: 0 };
            if (typeof this.analytics.averageClicksPerDay !== 'number') this.analytics.averageClicksPerDay = 0;
            if (typeof this.analytics.totalUniqueVisitors !== 'number') this.analytics.totalUniqueVisitors = 0;
            
            const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
            const currentMonth = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
            
            try {
                const currentHourCount = this.analytics.hourlyDistribution.get(currentHour.toString()) || 0;
                this.analytics.hourlyDistribution.set(currentHour.toString(), currentHourCount + 1);
                
                if (currentHourCount + 1 > this.analytics.peakHour.count) {
                    this.analytics.peakHour = { hour: currentHour, count: currentHourCount + 1 };
                }
                
            } catch (hourError) {
                console.error('Error updating hourly distribution:', hourError);
            }
            
            try {
                const todayEntry = this.analytics.dailyClicks.find(entry => {
                    if (!entry.date) return false;
                    const entryDate = new Date(entry.date);
                    const entryDateStr = entryDate.toISOString().split('T')[0];
                    const todayDateStr = now.toISOString().split('T')[0];
                    return entryDateStr === todayDateStr;
                });
                
                if (todayEntry) {
                    todayEntry.count += 1;
                    if (todayEntry.count > this.analytics.peakDay.count) {
                        this.analytics.peakDay = { date: today, count: todayEntry.count };
                    }
                } else {
                    this.analytics.dailyClicks.push({ date: today, count: 1 });
                    
                    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                    this.analytics.dailyClicks = this.analytics.dailyClicks.filter(entry => 
                        entry.date && new Date(entry.date) >= ninetyDaysAgo
                    );
                }
                
            } catch (dailyError) {
                console.error('Error updating daily clicks:', dailyError);
            }
            
            try {
                const monthEntry = this.analytics.monthlyClicks.find(entry => entry.month === currentMonth);
                if (monthEntry) {
                    monthEntry.count += 1;
                } else {
                    this.analytics.monthlyClicks.push({ month: currentMonth, count: 1 });
                    if (this.analytics.monthlyClicks.length > 12) {
                        this.analytics.monthlyClicks.sort((a, b) => a.month.localeCompare(b.month));
                        this.analytics.monthlyClicks = this.analytics.monthlyClicks.slice(-12);
                    }
                }
            } catch (monthlyError) {
                console.error('Error updating monthly clicks:', monthlyError);
            }
            
            if (analyticsData.ip && analyticsData.ip !== 'unknown') {
                try {
                    const ipEntry = this.analytics.uniqueIPs.find(entry => entry.ip === analyticsData.ip);
                    if (ipEntry) {
                        ipEntry.lastSeen = now;
                        ipEntry.clickCount += 1;
                    } else {
                        this.analytics.uniqueIPs.push({
                            ip: analyticsData.ip,
                            firstSeen: now,
                            lastSeen: now,
                            clickCount: 1
                        });
                        this.analytics.totalUniqueVisitors += 1;
                    }
                    
                    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    this.analytics.uniqueIPs = this.analytics.uniqueIPs.filter(entry => 
                        entry.lastSeen && entry.lastSeen >= thirtyDaysAgo
                    );

                    if (this.analytics.uniqueIPs.length > 1000) {
                        this.analytics.uniqueIPs.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
                        this.analytics.uniqueIPs = this.analytics.uniqueIPs.slice(0, 500);
                    }

                } catch (ipError) {
                    console.error('Error updating IP analytics:', ipError);
                }
            }
            
            if (analyticsData.referer) {
                try {
                    const domain = this.extractDomain(analyticsData.referer);
                    const referrerEntry = this.analytics.referrers.find(entry => entry.domain === domain);
                    if (referrerEntry) {
                        referrerEntry.count += 1;
                        referrerEntry.lastSeen = now;
                    } else {
                        this.analytics.referrers.push({ domain, count: 1, lastSeen: now });
                    }
                    
                    if (this.analytics.referrers.length > 50) {
                        this.analytics.referrers.sort((a, b) => b.count - a.count);
                        this.analytics.referrers = this.analytics.referrers.slice(0, 50);
                    }
                } catch (refError) {
                    console.error('Error updating referrer analytics:', refError);
                }
            }
            
            if (analyticsData.country && typeof analyticsData.country === 'string') {
                try {
                    const countryEntry = this.analytics.countries.find(entry => entry.country === analyticsData.country);
                    if (countryEntry) {
                        countryEntry.count += 1;
                        countryEntry.lastSeen = now;
                    } else {
                        this.analytics.countries.push({ 
                            country: analyticsData.country, 
                            count: 1, 
                            lastSeen: now 
                        });
                    }
                } catch (countryError) {
                    console.error('Error updating country analytics:', countryError);
                }
            }
            
            if (analyticsData.city && analyticsData.country && 
                typeof analyticsData.city === 'string' && typeof analyticsData.country === 'string') {
                try {
                    const cityEntry = this.analytics.cities.find(entry => 
                        entry.city === analyticsData.city && entry.country === analyticsData.country
                    );
                    if (cityEntry) {
                        cityEntry.count += 1;
                        cityEntry.lastSeen = now;
                    } else {
                        this.analytics.cities.push({ 
                            city: analyticsData.city, 
                            country: analyticsData.country, 
                            count: 1, 
                            lastSeen: now 
                        });
                    }
                    
                    if (this.analytics.cities.length > 100) {
                        this.analytics.cities.sort((a, b) => b.count - a.count);
                        this.analytics.cities = this.analytics.cities.slice(0, 100);
                    }
                } catch (cityError) {
                    console.error('Error updating city analytics:', cityError);
                }
            }
            
            if (analyticsData.device && typeof analyticsData.device === 'string') {
                try {
                    const deviceEntry = this.analytics.devices.find(entry => entry.type === analyticsData.device);
                    if (deviceEntry) {
                        deviceEntry.count += 1;
                        deviceEntry.lastSeen = now;
                    } else {
                        const newDevice = { 
                            type: analyticsData.device, 
                            count: 1, 
                            lastSeen: now 
                        };
                        this.analytics.devices.push(newDevice);
                    }
                } catch (deviceError) {
                    console.error('Error updating device analytics:', deviceError);
                }
            }
            
            if (analyticsData.browser && typeof analyticsData.browser === 'object' && analyticsData.browser.name) {
                try {
                    const browserEntry = this.analytics.browsers.find(entry => 
                        entry.name === analyticsData.browser.name
                    );
                    if (browserEntry) {
                        browserEntry.count += 1;
                        browserEntry.lastSeen = now;
                    } else {
                        this.analytics.browsers.push({ 
                            name: analyticsData.browser.name, 
                            version: analyticsData.browser.version || '', 
                            count: 1, 
                            lastSeen: now 
                        });
                    }
                    
                    if (this.analytics.browsers.length > 20) {
                        this.analytics.browsers.sort((a, b) => b.count - a.count);
                        this.analytics.browsers = this.analytics.browsers.slice(0, 20);
                    }
                } catch (browserError) {
                    console.error('Error updating browser analytics:', browserError);
                }
            }
            
            if (analyticsData.os && typeof analyticsData.os === 'object' && analyticsData.os.name) {
                try {
                    const osEntry = this.analytics.operatingSystems.find(entry => 
                        entry.name === analyticsData.os.name
                    );
                    if (osEntry) {
                        osEntry.count += 1;
                        osEntry.lastSeen = now;
                    } else {
                        this.analytics.operatingSystems.push({ 
                            name: analyticsData.os.name, 
                            version: analyticsData.os.version || '', 
                            count: 1, 
                            lastSeen: now 
                        });
                    }
                    
                    if (this.analytics.operatingSystems.length > 15) {
                        this.analytics.operatingSystems.sort((a, b) => b.count - a.count);
                        this.analytics.operatingSystems = this.analytics.operatingSystems.slice(0, 15);
                    }
                } catch (osError) {
                    console.error('Error updating OS analytics:', osError);
                }
            }
            
            try {
                if (this.analytics.dailyClicks && this.analytics.dailyClicks.length > 0) {
                    const totalDays = this.analytics.dailyClicks.length;
                    const totalClicks = this.analytics.dailyClicks.reduce((sum, day) => sum + (day.count || 0), 0);
                    this.analytics.averageClicksPerDay = Math.round((totalClicks / totalDays) * 100) / 100;
                }
            } catch (avgError) {
                console.error('Error calculating average clicks per day:', avgError);
            }
            
            const result = await this.save();
            resolve(result);
            
        } catch (error) {
            console.error('Critical error in addClick:', error);
            try {
                this.clicks += 1;
                this.lastClickedAt = new Date();
                const result = await this.save();
                resolve(result);
            } catch (saveError) {
                console.error('Emergency save also failed:', saveError);
                reject(saveError);
            }
        }
    });
};

linkSchema.methods.extractDomain = function(url) {
    try {
        if (!url || url === 'Direct') return 'Direct';
        const domain = new URL(url).hostname;
        return domain.replace('www.', '');
    } catch {
        return 'Direct';
    }
};

linkSchema.statics.getTopLinks = function(limit = 10, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    return this.find({ isActive: true, lastClickedAt: { $gte: startDate } })
        .sort({ clicks: -1 })
        .limit(limit)
        .select('slug originalUrl clicks analytics.totalUniqueVisitors createdAt createdByUsername');
};

linkSchema.statics.getRecentLinks = function(userId, limit = 10) {
    return this.find({ createdBy: userId, isActive: true })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select('slug originalUrl clicks createdAt');
};

linkSchema.statics.getTotalClicks = function(userId = null, days = null) {
    let matchQuery = {};
    
    if (userId) matchQuery.createdBy = userId;
    if (days) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        matchQuery.lastClickedAt = { $gte: startDate };
    }
    
    return this.aggregate([
        { $match: matchQuery },
        { $group: { _id: null, totalClicks: { $sum: '$clicks' } } }
    ]);
};

linkSchema.statics.getTodayClicks = function(userId = null) {
    const today = new Date();
    const todayStart = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    
    let matchQuery = { 
        isActive: true,
        'analytics.dailyClicks': { $exists: true }
    };
    if (userId) matchQuery.createdBy = userId;
    
    return this.aggregate([
        { $match: matchQuery },
        { $unwind: '$analytics.dailyClicks' },
        { 
            $match: { 
                'analytics.dailyClicks.date': { 
                    $gte: todayStart, 
                    $lt: tomorrowStart 
                }
            }
        },
        {
            $group: {
                _id: null,
                todayClicks: { $sum: '$analytics.dailyClicks.count' }
            }
        }
    ]);
};

linkSchema.statics.getClicksByDateRange = function(startDate, endDate, userId = null) {
    let matchQuery = { 
        'analytics.dailyClicks.date': { $gte: startDate, $lte: endDate }
    };
    if (userId) matchQuery.createdBy = userId;
    
    return this.aggregate([
        { $match: matchQuery },
        { $unwind: '$analytics.dailyClicks' },
        { 
            $match: { 
                'analytics.dailyClicks.date': { $gte: startDate, $lte: endDate }
            }
        },
        {
            $group: {
                _id: '$analytics.dailyClicks.date',
                totalClicks: { $sum: '$analytics.dailyClicks.count' },
                linkCount: { $sum: 1 }
            }
        },
        { $sort: { '_id': 1 } }
    ]);
};

linkSchema.statics.getTopReferrers = function(limit = 10, userId = null) {
    let matchQuery = { isActive: true };
    if (userId) matchQuery.createdBy = userId;
    
    return this.aggregate([
        { $match: matchQuery },
        { $unwind: '$analytics.referrers' },
        {
            $group: {
                _id: '$analytics.referrers.domain',
                totalClicks: { $sum: '$analytics.referrers.count' },
                linkCount: { $sum: 1 }
            }
        },
        { $sort: { totalClicks: -1 } },
        { $limit: limit }
    ]);
};

linkSchema.statics.getTopCountries = function(limit = 10, userId = null) {
    let matchQuery = { isActive: true };
    if (userId) matchQuery.createdBy = userId;
    
    return this.aggregate([
        { $match: matchQuery },
        { $unwind: '$analytics.countries' },
        {
            $group: {
                _id: '$analytics.countries.country',
                totalClicks: { $sum: '$analytics.countries.count' },
                linkCount: { $sum: 1 }
            }
        },
        { $sort: { totalClicks: -1 } },
        { $limit: limit }
    ]);
};

linkSchema.statics.getDeviceStats = function(userId = null) {
    let matchQuery = { isActive: true };
    if (userId) matchQuery.createdBy = userId;
    
    return this.aggregate([
        { $match: matchQuery },
        { $unwind: '$analytics.devices' },
        {
            $group: {
                _id: '$analytics.devices.type',
                totalClicks: { $sum: '$analytics.devices.count' },
                linkCount: { $sum: 1 }
            }
        },
        { $sort: { totalClicks: -1 } }
    ]);
};

linkSchema.statics.getBrowserStats = function(userId = null) {
    let matchQuery = { isActive: true };
    if (userId) matchQuery.createdBy = userId;
    
    return this.aggregate([
        { $match: matchQuery },
        { $unwind: '$analytics.browsers' },
        {
            $group: {
                _id: '$analytics.browsers.name',
                totalClicks: { $sum: '$analytics.browsers.count' },
                linkCount: { $sum: 1 }
            }
        },
        { $sort: { totalClicks: -1 } },
        { $limit: 10 }
    ]);
};

linkSchema.statics.getOverallStats = function(userId = null) {
    let matchQuery = { isActive: true };
    if (userId) matchQuery.createdBy = userId;
    
    return this.aggregate([
        { $match: matchQuery },
        {
            $group: {
                _id: null,
                totalLinks: { $sum: 1 },
                totalClicks: { $sum: '$clicks' },
                totalUniqueVisitors: { $sum: '$analytics.totalUniqueVisitors' },
                averageClicksPerLink: { $avg: '$clicks' },
                averageClicksPerDay: { $avg: '$analytics.averageClicksPerDay' }
            }
        }
    ]);
};

// 3974-143-a3d7e9

linkSchema.statics.getDailyClicksData = function(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    return this.aggregate([
        { 
            $match: { 
                isActive: true,
                'analytics.dailyClicks': { $exists: true }
            }
        },
        { $unwind: '$analytics.dailyClicks' },
        { 
            $match: { 
                'analytics.dailyClicks.date': { $gte: startDate }
            }
        },
        {
            $group: {
                _id: '$analytics.dailyClicks.date',
                clicks: { $sum: '$analytics.dailyClicks.count' }
            }
        },
        { $sort: { '_id': 1 } },
        {
            $project: {
                date: { 
                    $dateToString: { 
                        format: '%Y-%m-%d', 
                        date: '$_id',
                        timezone: 'UTC'
                    } 
                },
                clicks: 1,
                _id: 0
            }
        }
    ]);
};

linkSchema.statics.getHourlyDistribution = function() {
    return this.aggregate([
        { 
            $match: { 
                isActive: true,
                'analytics.hourlyDistribution': { $exists: true }
            }
        },
        {
            $project: {
                hourlyData: { $objectToArray: '$analytics.hourlyDistribution' }
            }
        },
        { $unwind: '$hourlyData' },
        {
            $group: {
                _id: '$hourlyData.k',
                totalClicks: { $sum: '$hourlyData.v' }
            }
        },
        { $sort: { '_id': 1 } }
    ]).then(results => {
        const hourlyData = {};
        for (let i = 0; i < 24; i++) {
            hourlyData[i] = 0;
        }
        
        results.forEach(result => {
            hourlyData[parseInt(result._id)] = result.totalClicks;
        });
        
        return hourlyData;
    });
};

module.exports = mongoose.model('Link', linkSchema);