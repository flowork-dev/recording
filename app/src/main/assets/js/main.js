// File: app/src/main/assets/js/main.js

// [HYBRID] Fungsi Fetch Apps (Smart Cache: Instant Load + Background Update)
async function fetchApps() {
    try {
        // [SETUP] Definisi Variabel
        let localApps = [];
        const CACHE_KEY = 'fw_registry_cache';
        const ADS_CACHE_KEY = 'fw_ads_storage'; // Key untuk simpan ads selamanya

        let cachedRegistryData = null;

        // =================================================================
        // 1. ADS STRATEGY: "CACHE FOREVER + BACKGROUND SYNC"
        // =================================================================
        const cachedAdsStr = localStorage.getItem(ADS_CACHE_KEY);
        let localAdsId = null;

        if (cachedAdsStr) {
            try {
                const parsedAds = JSON.parse(cachedAdsStr);
                localAdsId = parsedAds.id;

                if (parsedAds.ads && Array.isArray(parsedAds.ads)) {
                    globalAds = parsedAds.ads;
                    console.log(`⚡ Ads Loaded from Cache: ${localAdsId}`);
                }
            } catch (errAds) {
                console.warn("Ads Cache Corrupt, clearing...");
                localStorage.removeItem(ADS_CACHE_KEY);
            }
        }
        // =================================================================

        // 2. LOAD LOCAL APPS
        try {
            const resLocal = await fetch('store/local_registry.json');
            if (resLocal.ok) {
                const localData = await resLocal.json();
                localApps = (Array.isArray(localData) ? localData : (localData.apps || [])).map(app => ({
                    ...app,
                    source: 'local'
                }));
            }
        } catch (errLocal) { console.warn("No Local Apps found"); }

        // 3. CEK CACHE CLOUD APPS
        const cachedDataStr = localStorage.getItem(CACHE_KEY);
        let currentCloudApps = [];

        if (cachedDataStr) {
            try {
                cachedRegistryData = JSON.parse(cachedDataStr);
                if (cachedRegistryData.meta && cachedRegistryData.meta.version) {
                     console.log(`⚡ Apps Loaded: Version ${cachedRegistryData.meta.version}`);
                } else {
                     console.log("⚡ Apps Loaded: Legacy Cache");
                }
                currentCloudApps = Array.isArray(cachedRegistryData) ? cachedRegistryData : (cachedRegistryData.apps || []);
                renderAndMerge(localApps, currentCloudApps);
            } catch (e) {
                console.error("Cache Corrupt:", e);
                localStorage.removeItem(CACHE_KEY);
            }
        }

        // 4. NETWORK CHECK: APPS
        if (navigator.onLine) {
            console.log("🔄 Checking App Updates...");
            try {
                const resCloud = await fetch(`${BASE_URL}/store/registry.json?t=${Date.now()}`, { cache: "no-store" });
                if (resCloud.ok) {
                    const serverData = await resCloud.json();
                    const serverApps = serverData.apps || [];
                    const serverVer = serverData.meta?.version;
                    const localVer = cachedRegistryData?.meta?.version;

                    if (serverVer !== localVer) {
                        console.log(`🚨 APP UPDATE FOUND! [${localVer} -> ${serverVer}]`);

                        if (cachedRegistryData && cachedRegistryData.apps) {
                             const newAppIds = new Set(serverApps.map(a => a.id));
                             cachedRegistryData.apps.forEach(oldApp => {
                                 if (!newAppIds.has(oldApp.id)) {
                                     console.log(`💀 Killing Zombie App Cache: ${oldApp.id}`);
                                     localStorage.removeItem(`fw_app_cache_${oldApp.id}`);
                                 }
                             });
                        }
                        localStorage.setItem(CACHE_KEY, JSON.stringify(serverData));
                        renderAndMerge(localApps, serverApps);
                        sys.toast("System Updated: " + serverVer);
                    } else {
                        console.log("✅ Apps are Up-to-Date.");
                    }
                }
            } catch (errCloud) { console.warn("App Update Failed:", errCloud); }
        }

        // 5. NETWORK CHECK: ADS (Sinkronisasi ID)
        if (navigator.onLine) {
            console.log("🔄 Syncing Ads...");
            fetch(`${BASE_URL}/store/ads.json?t=${Date.now()}`)
                .then(res => {
                    if (res.ok) return res.json();
                    throw new Error("Ads Fetch Failed");
                })
                .then(serverAdsData => {
                    const serverId = serverAdsData.id;

                    // Update jika ID beda ATAU jika globalAds masih kosong (misal local storage dihapus manual)
                    if ((serverId && serverId !== localAdsId) || globalAds.length === 0) {
                        console.log(`🚨 ADS UPDATE FOUND! [${localAdsId} -> ${serverId}]`);

                        globalAds = serverAdsData.ads || [];
                        localStorage.setItem(ADS_CACHE_KEY, JSON.stringify(serverAdsData));

                        // [FIX] FORCE RENDER UI dengan Timeout kecil agar aman
                        if (!sys.activeApp && typeof renderDashboard === 'function') {
                            console.log("♻️ Refreshing UI for new Ads...");
                            setTimeout(() => {
                                renderDashboard(installedApps);
                                sys.toast("Promo Updated");
                            }, 50);
                        }
                    } else {
                        console.log("✅ Ads are Up-to-Date (Using Cache)");
                    }
                })
                .catch(e => console.warn("Ads Sync Skipped:", e.message));
        }

        // [ADDED] SPLASH SCREEN ADS SYSTEM INIT
        sys.initSplashAds();

        sys.startBackgroundPrefetch();

    } catch(e) { console.error("Critical Registry Error:", e); }
}

// [ADDED] SPLASH ADS SYSTEM LOGIC
sys.initSplashAds = async () => {
    const SPLASH_STORAGE_KEY = 'fw_splash_config';
    const SPLASH_TIME_KEY = 'fw_splash_next_trigger';

    // 1. Load Local Cache
    let splashConfig = null;
    try {
        const cached = localStorage.getItem(SPLASH_STORAGE_KEY);
        if(cached) splashConfig = JSON.parse(cached);
    } catch(e) { localStorage.removeItem(SPLASH_STORAGE_KEY); }

    // 2. Fetch Remote Config (Background)
    if(navigator.onLine) {
        try {
            const res = await fetch(`${BASE_URL}/store/splash.json?t=${Date.now()}`);
            if(res.ok) {
                const serverConfig = await res.json();
                const serverId = serverConfig.id;
                const localId = splashConfig ? splashConfig.id : null;

                // Jika ID berubah, reset timer untuk "Initial Delay"
                if(serverId !== localId) {
                    console.log("🆕 New Splash Ads Batch Found!");
                    localStorage.setItem(SPLASH_STORAGE_KEY, JSON.stringify(serverConfig));
                    splashConfig = serverConfig;

                    // Set trigger time = Sekarang + Initial Delay
                    const delayMs = (serverConfig.settings?.initial_delay_minutes || 1) * 60 * 1000;
                    const nextTrigger = Date.now() + delayMs;
                    localStorage.setItem(SPLASH_TIME_KEY, nextTrigger);
                    console.log(`⏱️ Splash Timer Reset. Next ad in: ${delayMs/1000}s`);
                } else {
                    console.log("✅ Splash Ads Config Up-to-date");
                }
            }
        } catch(e) { console.warn("Splash Config Fetch Failed:", e.message); }
    }

    // 3. Start Timer Loop
    if(splashConfig) {
        sys.splashAdLoop();
    }
};

sys.splashAdLoop = () => {
    const SPLASH_TIME_KEY = 'fw_splash_next_trigger';

    setInterval(() => {
        // Cek apakah waktu trigger sudah lewat
        const nextTrigger = parseInt(localStorage.getItem(SPLASH_TIME_KEY) || '0');
        const now = Date.now();

        if(nextTrigger > 0 && now >= nextTrigger) {
            // Cek apakah UI sedang sibuk?
            if(sys.isUiBusy()) {
                // UI Sibuk -> Set Flag Pending
                if(!sys.pendingSplashAd) {
                    console.log("⚠️ Splash Ad ready but UI busy. Queued.");
                    sys.pendingSplashAd = true;
                }
            } else {
                // UI Aman -> Show Ad
                sys.triggerSplashAd();
            }
        }
    }, 5000); // Cek setiap 5 detik
};

// Helper: Cek apakah UI sedang "Sibuk" (Ada overlay lain atau sedang di App)
sys.isUiBusy = () => {
    // 1. Cek apakah sedang di dalam App (bukan Dashboard)
    if(sys.activeApp) return true;

    // 2. Cek apakah ada overlay fullscreen yang aktif (Login, Vault, Pin, dll)
    const overlays = document.querySelectorAll('.full-overlay');
    for(let el of overlays) {
        if(el.style.display !== 'none' && el.style.display !== '') return true;
    }

    // 3. Cek apakah Sidebar terbuka
    const leftSidebar = document.getElementById('sidebar-left');
    const rightSidebar = document.getElementById('sidebar-right');
    if(leftSidebar && leftSidebar.classList.contains('open')) return true;
    if(rightSidebar && rightSidebar.classList.contains('open')) return true;

    return false;
};

// [UPDATED] Trigger Ad & Render Logic (SENSITIVE TOUCH + INSTANT CLOSE)
sys.triggerSplashAd = () => {
    const SPLASH_STORAGE_KEY = 'fw_splash_config';
    const SPLASH_TIME_KEY = 'fw_splash_next_trigger';

    try {
        const config = JSON.parse(localStorage.getItem(SPLASH_STORAGE_KEY));
        if(!config || !config.pool || config.pool.length === 0) return;

        // Weighted Random Selection
        const pool = [];
        config.pool.forEach(ad => {
            const weight = ad.weight || 1;
            for(let i=0; i<weight; i++) pool.push(ad);
        });

        const selectedAd = pool[Math.floor(Math.random() * pool.length)];

        // [MODIFIKASI] Render UI Langsung di sini untuk Kecepatan & Kontrol
        const overlay = document.createElement('div');
        overlay.className = 'splash-ad-overlay active'; // active class agar opacity 1

        // Style tambahan untuk memastikan full cover & touch capture
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: #000; z-index: 999999; display: flex; align-items: center; justify-content: center;
            opacity: 0; transition: opacity 0.3s ease; touch-action: none;
        `;

        const img = document.createElement('img');
        // [FIXED] GUNAKAN KEY 'img' BUKAN 'image' SESUAI JSON
        img.src = selectedAd.img;
        img.className = 'splash-ad-img';
        img.style.cssText = 'width: 100%; height: 100%; object-fit: cover; cursor: pointer;';

        const closeBtn = document.createElement('div');
        closeBtn.className = 'splash-ad-close';
        closeBtn.innerHTML = '<i class="mdi mdi-close"></i>';
        closeBtn.style.cssText = `
            position: absolute; top: 25px; right: 25px; width: 36px; height: 36px;
            background: rgba(0,0,0,0.6); border-radius: 50%; color: #fff;
            display: flex; align-items: center; justify-content: center; font-size: 20px;
            border: 1px solid rgba(255,255,255,0.3); cursor: pointer; z-index: 1000000;
        `;

        // Variable Lock agar Close tidak trigger Open
        let isActionTaken = false;

        // [CRITICAL FIX] Handler Klik SUPER SENSITIF
        const openAd = (e) => {
            if(isActionTaken) return;
            isActionTaken = true;

            // Visual Touch Feedback
            img.style.opacity = '0.5';

            // [FIXED] GUNAKAN KEY 'link' BUKAN 'url' SESUAI JSON
            const targetUrl = selectedAd.link;

            // 1. Buka Link via NATIVE ANDROID SECEPAT MUNGKIN
            if (typeof Android !== 'undefined' && Android.openInBrowser) {
                Android.openInBrowser(targetUrl);
            } else {
                window.open(targetUrl, '_blank');
            }

            // 2. LANGSUNG HAPUS OVERLAY (INSTANT CLOSE)
            // Tidak pakai fade out, langsung hilang biar user balik ke app sudah bersih
            overlay.remove();
        };

        const closeAd = (e) => {
            e.stopPropagation(); // Stop event biar gak nembus ke gambar
            e.preventDefault();

            if(isActionTaken) return;
            isActionTaken = true;

            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 250);
        };

        // [SENSITIVITY UPGRADE] Gunakan 'touchstart' agar kena dikit langsung jalan
        img.addEventListener('touchstart', openAd, { passive: true });
        img.addEventListener('mousedown', openAd); // Backup mouse
        img.addEventListener('click', openAd);     // Backup click

        // Tombol Close
        closeBtn.addEventListener('touchstart', closeAd, { passive: false });
        closeBtn.addEventListener('click', closeAd);

        overlay.appendChild(img);
        overlay.appendChild(closeBtn);
        document.body.appendChild(overlay);

        // Animasi Masuk
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
        });

        // Reset Timer (Next Interval)
        const intervalMs = (config.settings?.interval_minutes || 20) * 60 * 1000;
        const nextTime = Date.now() + intervalMs;
        localStorage.setItem(SPLASH_TIME_KEY, nextTime);

        sys.pendingSplashAd = false; // Clear queue
        console.log(`✅ Splash Ad Shown. Next in ${config.settings?.interval_minutes} mins`);

    } catch(e) { console.error("Splash Trigger Error:", e); }
};

// Fungsi Helper untuk Merge & Render (Biar tidak duplikasi kode)
function renderAndMerge(localApps, cloudApps) {
    const markedCloudApps = cloudApps.map(app => ({ ...app, source: 'cloud' }));
    let mergedApps = [...localApps, ...markedCloudApps];
    const uniqueMap = new Map();
    mergedApps.forEach(item => {
        const key = item.slug || item.id;
        if (!uniqueMap.has(key) || item.source === 'local') {
            uniqueMap.set(key, item);
        }
    });

    let uniqueApps = Array.from(uniqueMap.values());
    uniqueApps = uniqueApps.filter(app => app.android === 'yes');

    // [MODIFIKASI] Randomize Order (Shuffle)
    // Menggunakan algoritma Fisher-Yates Shuffle agar benar-benar acak
    // Ini hanya dipanggil saat fetchApps (buka aplikasi) atau update
    for (let i = uniqueApps.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [uniqueApps[i], uniqueApps[j]] = [uniqueApps[j], uniqueApps[i]];
    }

    installedApps = uniqueApps; // Set hasil acakan ke memori global

    if (!window.location.search.includes('src=')) { renderDashboard(installedApps); }
    updateSidebar();
}

// [FINAL FITUR] BACKGROUND PRE-FETCHER (SMART VERSION)
sys.startBackgroundPrefetch = async () => {
    if (!navigator.onLine) return;
    const essentialAssets = [
        'css/style.css', 'js/ai.js', 'js/ui.js', 'js/crypto.js', 'js/marked.js', 'js/html2pdf.js'
    ];
    console.log("🚀 Starting Smart Asset Prefetch...");
    for (const url of essentialAssets) {
        try { await fetch(url, { cache: 'no-cache' }); } catch(e) { /* Silent fail */ }
    }
    console.log("✅ Smart Asset Prefetch Complete");
};

// [ADDED] Fungsi Tampilan Error Cantik
sys.showError = (title, message, retryAction) => {
    if(!nativeRoot) return;
    nativeRoot.innerHTML = `
        <div class="sys-error-container">
            <i class="mdi mdi-wifi-off sys-error-icon"></i>
            <div class="sys-error-title">${title}</div>
            <div class="sys-error-desc">${message}</div>
            <button id="sys-retry-btn" class="sys-retry-btn">
                <i class="mdi mdi-refresh"></i> Try Again
            </button>
        </div>
    `;
    const btn = document.getElementById('sys-retry-btn');
    if(btn) btn.onclick = () => {
        nativeRoot.innerHTML = ''; // Clear error
        if(typeof retryAction === 'function') retryAction();
    };
};

// [ANTI-ZOMBIE] SYSTEM BOOTER - REFACTORED FOR SMART MANIFEST CACHING + ERROR UI
sys.boot = async (url, name) => {
    // Helper function untuk menjalankan Code (Eval alternative)
    const runCode = (code) => {
        if(nativeRoot) nativeRoot.innerHTML = '';
        const app = new Function('return ' + code)();
        app.mount(sys);
        sys.activeApp = app;
        if (sys.enterFullscreenMode) sys.enterFullscreenMode();
        setupBackButton();
    };

    // Helper untuk membuat Tombol Back (Flush Design)
    const setupBackButton = () => {
        const backBtnId = 'sys-floating-back';
        let backBtn = document.getElementById(backBtnId);
        if (backBtn) backBtn.remove();

        backBtn = document.createElement('div');
        backBtn.id = backBtnId;
        document.body.appendChild(backBtn);
        // Style CSS sudah diatur di style.css untuk flush bottom-right
        backBtn.innerHTML = `<i class="mdi mdi-arrow-left" style="font-size: 22px;"></i>`;
        backBtn.onclick = () => {
             backBtn.style.transform = 'scale(0.9)';
             setTimeout(() => {
                 console.log("Closing App & Cleaning RAM...");
                 if (sys.activeApp && typeof sys.activeApp.unmount === 'function') {
                     try { sys.activeApp.unmount(); } catch(e) { console.error("Error unmounting app:", e); }
                 }
                 sys.activeApp = null;
                 if(nativeRoot) nativeRoot.innerHTML = '';
                 backBtn.remove();
                 sys.goHome();
             }, 150);
        };
    };

    try {
        // [RULE 1] Jangan tampilkan Loader jika tidak perlu (Untuk kesan instant)
        // if(loader) loader.style.display = 'flex'; // COMMENTED OUT: Loader hanya muncul jika download

        // Cleanup Zombie
        if (sys.activeApp) {
            console.log("Killing previous zombie app...");
            if (typeof sys.activeApp.unmount === 'function') {
                try { sys.activeApp.unmount(); } catch(e) { console.warn("Zombie unmount error:", e); }
            }
            sys.activeApp = null;
        }
        if (sys.aiAppInstance) {
            try { sys.aiAppInstance.unmount(); } catch (e) {}
            sys.aiAppInstance = null;
        }

        // 1. Generate ID Unik untuk Cache berdasarkan URL Logic
        // Kita gunakan btoa(url) sebagai key yang unik dan aman
        const appCacheId = "fw_smart_cache_" + btoa(url);
        const metaKey = appCacheId + "_meta"; // Simpan manifest
        const codeKey = appCacheId + "_code"; // Simpan logic.js string

        // 2. Cek Local Cache
        let localMeta = null;
        let localCode = null;
        try {
            localMeta = JSON.parse(localStorage.getItem(metaKey));
            localCode = localStorage.getItem(codeKey);
        } catch(e) {}

        // 3. Tentukan Manifest URL (Bersebelahan dengan logic.js)
        // Contoh: .../anti-spy/logic.js -> .../anti-spy/manifest.json
        const baseUrl = url.substring(0, url.lastIndexOf('/'));
        const manifestUrl = `${baseUrl}/manifest.json`;

        // 4. Logika Offline / Online & Version Check
        if (!navigator.onLine) {
            // --- MODE OFFLINE ---
            if (localCode) {
                console.log("📴 Offline Mode: Booting from Cache Instant!");
                runCode(localCode);
                return; // Sukses, berhenti di sini
            } else {
                // [NEW] TAMPILKAN ERROR UI JIKA OFFLINE & NO CACHE
                sys.showError("No Connection", "You are offline and this app is not cached yet.", () => {
                    sys.boot(url, name); // Retry Action
                });
                return;
            }
        } else {
            // --- MODE ONLINE ---
            try {
                // Fetch Manifest TERBARU (timestamp agar tidak kena cache browser saat cek versi)
                const resManifest = await fetch(manifestUrl + '?t=' + Date.now());

                if (resManifest.ok) {
                    const remoteMeta = await resManifest.json();

                    // Ambil versi (support 'ver' atau 'version')
                    const remoteVer = remoteMeta.version || remoteMeta.ver || "1.0.0";
                    const localVer = localMeta ? (localMeta.version || localMeta.ver) : null;

                    // CHECK VERSION: Compare Remote vs Local
                    if (localCode && localVer === remoteVer) {
                        // VERSI SAMA -> GUNAKAN CACHE (INSTANT)
                        console.log(`✅ Version Match (${localVer}). Booting from Cache.`);
                        runCode(localCode);
                    } else {
                        // VERSI BEDA atau CACHE KOSONG -> DOWNLOAD BARU
                        console.log(`🔄 Update Found or New App (${localVer} -> ${remoteVer}). Downloading...`);

                        // Tampilkan loader hanya saat benar-benar download
                        if(loader) loader.style.display = 'flex';

                        const resCode = await fetch(url + '?t=' + Date.now()); // Download logic.js baru
                        if (!resCode.ok) throw new Error("Logic Fetch Failed");

                        const newCode = await resCode.text();

                        // SIMPAN CACHE BARU SELAMANYA
                        localStorage.setItem(metaKey, JSON.stringify(remoteMeta));
                        localStorage.setItem(codeKey, newCode);

                        console.log("💾 App Cached Successfully!");
                        if(loader) loader.style.display = 'none'; // Sembunyikan loader
                        runCode(newCode);
                    }
                } else {
                    // Gagal ambil manifest (misal 404), fallback ke metode lama atau cache
                    console.warn("Manifest not found, fallback logic...");
                    if(localCode) runCode(localCode);
                    else {
                        // Fallback total: fetch url langsung tanpa cek manifest
                        const res = await fetch(url);
                        const code = await res.text();
                        runCode(code);
                    }
                }

            } catch (err) {
                console.error("Network/Manifest Error:", err);
                // Jika error network saat cek manifest, tapi punya cache, PAKAI CACHE
                if (localCode) {
                    console.log("⚠️ Network Error, using Cache fallback.");
                    runCode(localCode);
                } else {
                    // [NEW] ERROR UI JIKA NETWORK GAGAL & NO CACHE
                    sys.showError("Connection Failed", "Unable to download app data. Please check your connection.", () => {
                        sys.boot(url, name);
                    });
                }
                if(loader) loader.style.display = 'none';
            }
        }

    } catch(e) {
        console.error("Boot Error:", e);
        // [NEW] ERROR UI UNTUK UNKNOWN ERROR
        sys.showError("System Error", "Failed to load app.<br>" + e.message, () => {
            sys.boot(url, name);
        });
        if(loader) loader.style.display = 'none';
    }
};

sys.clearCache = () => {
    const confirmMsg = sys.t('confirm_clear_cache') || "Reset System Cache & Reload?";
    if (confirm(confirmMsg)) {
        try {
            localStorage.removeItem('fw_registry_cache');
            localStorage.removeItem('fw_registry_time');
            localStorage.removeItem('fw_asset_prefetch_time');
            localStorage.removeItem('fw_ads_storage');
            // [ADDED] Clear Splash Cache too
            localStorage.removeItem('fw_splash_config');
            localStorage.removeItem('fw_splash_next_trigger');

            // [ADDED] CLEAR SMART APP CACHE (Hapus semua key fw_smart_cache_)
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith('fw_app_cache_') || key.startsWith('fw_smart_cache_')) {
                    localStorage.removeItem(key);
                }
            });

            sys.toast(sys.t('toast_cache_cleared') || "Cache Cleared!");
            setTimeout(() => { window.location.reload(); }, 1000);
        } catch (e) {
            console.error(e);
            sys.toast("Error clearing cache");
        }
    }
};

sys.download = (data, filename, mimeType = "application/octet-stream") => {
    const sendChunks = (base64String) => {
        try {
            sys.toast("Memulai Download " + filename + "...");
            Android.startChunkDownload(filename, mimeType);
            var chunkSize = 500 * 1024;
            var totalChunks = Math.ceil(base64String.length / chunkSize);
            for (var i = 0; i < totalChunks; i++) {
                var chunk = base64String.substr(i * chunkSize, chunkSize);
                Android.appendChunk(chunk);
            }
            Android.finishChunkDownload();
        } catch (e) {
            console.error("Chunk Error:", e);
            sys.toast("Gagal Download: " + e.message);
        }
    };

    if (typeof Android !== 'undefined' && Android.startChunkDownload) {
        if (data instanceof Blob) {
            var reader = new FileReader();
            reader.readAsDataURL(data);
            reader.onloadend = function() {
                var base64data = reader.result.split(',')[1];
                sendChunks(base64data);
            };
        } else if (typeof data === 'string' && data.startsWith('data:')) {
            var parts = data.split(',');
            if (parts.length > 1) { sendChunks(parts[1]); } else { sys.toast("Format Data URI Salah"); }
        } else { sys.toast("Format file tidak didukung untuk download"); }
    } else {
        console.log("Downloading via Browser Fallback");
        let url;
        if (data instanceof Blob) { url = URL.createObjectURL(data); } else { url = data; }
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        if (data instanceof Blob) URL.revokeObjectURL(url);
    }
};

sys.toggleMenu = () => {
    if (typeof Android !== 'undefined' && Android.toggleMenu) {
        Android.toggleMenu();
    } else {
        console.log("Toggle Menu clicked");
        alert("Fitur Floating Menu hanya di Android App");
    }
};

window.addEventListener('load', () => {
    nativeRoot = document.getElementById('native-root');
    loader = document.getElementById('loader');
    sys.root = nativeRoot;

    const savedTheme = localStorage.getItem('flowork_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    try { favoriteIds = JSON.parse(localStorage.getItem('flowork_favs')) || []; } catch(e) { favoriteIds = []; }

    const savedLang = localStorage.getItem('flowork_lang') || 'id';
    sys.setLang(savedLang);

    const savedNet = localStorage.getItem('flowork_wallet_net');
    if(savedNet && NETWORKS[savedNet]) {
        currentWalletNetwork = savedNet;
        const netSelect = document.getElementById('wallet-network-select');
        if(netSelect) netSelect.value = savedNet;
    }

    if (sys.checkAuth) sys.checkAuth();

    const params = new URLSearchParams(window.location.search);
    const src = params.get('src');
    if(src) {
        sys.boot(src, params.get('name'));
    } else {
        fetchApps();
    }
});