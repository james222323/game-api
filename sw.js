// Service Worker to serve files from IndexedDB
const DB_NAME = "fsgame_storage";
const STORE_NAME = "files";
const CACHE_VERSION = "v1";

// Open IndexedDB
const openDB = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = e => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME);
    }
  };
  req.onsuccess = e => resolve(e.target.result);
  req.onerror = e => reject(e.target.error);
});

// Get file from IndexedDB
const getFile = async (path) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(path);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Error getting file from IndexedDB:", err);
    return null;
  }
};

// Install event
self.addEventListener('install', (event) => {
  console.log('✅ Service Worker: Installing...');
  self.skipWaiting(); // Activate immediately
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('✅ Service Worker: Activating...');
  event.waitUntil(
    clients.claim().then(() => {
      console.log('✅ Service Worker: Now controlling all pages');
    })
  );
});

// Fetch event - intercept requests for game files
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Only intercept requests that start with /game/
  if (url.origin === location.origin && url.pathname.startsWith('/game/')) {
    // Extract the file path (remove /game/ prefix)
    const filePath = url.pathname.replace('/game/', '');
    
    console.log(`📂 Service Worker: Intercepting request for "${filePath}"`);
    
    event.respondWith(
      getFile(filePath)
        .then(blob => {
          if (blob) {
            console.log(`✅ Service Worker: Serving "${filePath}" from IndexedDB`);
            return new Response(blob, {
              status: 200,
              statusText: 'OK',
              headers: {
                'Content-Type': blob.type || 'application/octet-stream',
                'Content-Length': blob.size,
                'Cache-Control': 'no-cache'
              }
            });
          } else {
            console.warn(`⚠️ Service Worker: File "${filePath}" not found in IndexedDB`);
            return new Response('File not found', {
              status: 404,
              statusText: 'Not Found'
            });
          }
        })
        .catch(err => {
          console.error(`❌ Service Worker: Error serving "${filePath}":`, err);
          return new Response('Error loading file', {
            status: 500,
            statusText: 'Internal Server Error'
          });
        })
    );
    
    return; // Don't process this request further
  }
  
  // For all other requests, use default fetch behavior
  event.respondWith(fetch(event.request));
});

// Message event - for communication with the main page
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
