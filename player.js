export class FSGAMEPlayer {

  // Callback to update loader text
  static onUpdateLoading = null;

  // Register Service Worker to serve files from IndexedDB
  static async registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      console.warn("⚠️ Service Workers not supported in this browser");
      return false;
    }

    try {
      // Unregister any existing service workers first (clean slate)
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }

      // Register new service worker
      const registration = await navigator.serviceWorker.register('./sw.js', {
        scope: './'
      });

      console.log('✅ Service Worker registered:', registration.scope);

      // Wait for the service worker to be ready
      await navigator.serviceWorker.ready;
      
      // Wait a bit more to ensure it's active
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('✅ Service Worker is ready and active');
      return true;

    } catch (err) {
      console.error('❌ Service Worker registration failed:', err);
      return false;
    }
  }

  // Load game from a manifest.json URL
  static async loadFromManifest(manifestUrl) {
    // Safely get elements
    const loadingTextEl = document.getElementById("loading-text");
    const gameFrameEl = document.getElementById("game-frame");
    const loaderContainer = document.getElementById("loading-container");

    if (!loadingTextEl || !gameFrameEl || !loaderContainer) {
      console.error("❌ FSGAME Player: Missing required DOM elements.");
      return;
    }

    // Default callback if none provided
    if (!this.onUpdateLoading) {
      this.onUpdateLoading = (msg) => {
        loadingTextEl.textContent = msg;
      };
    }

    try {
      // Step 1: Fetch manifest
      this.onUpdateLoading("Fetching manifest...");
      const manifest = await fetch(manifestUrl).then(r => r.json());
      if (!manifest.files || !manifest.files.length)
        throw new Error("Manifest missing 'files' array.");

      // Step 2: Set blurred background image (image only)
      if (manifest.image) {
        // Create a background layer beneath loader content
        let bgLayer = document.getElementById("bg-blur-layer");
        if (!bgLayer) {
          bgLayer = document.createElement("div");
          bgLayer.id = "bg-blur-layer";
          Object.assign(bgLayer.style, {
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            backgroundImage: `url(${manifest.image})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(8px)",
            zIndex: "0",
            transform: "scale(1.05)",
          });
          document.body.prepend(bgLayer);
        }
      }

      // Step 3: Start downloading files
      const buffers = [];
      for (let i = 0; i < manifest.files.length; i++) {
        this.onUpdateLoading(`Fetching data... (${i + 1}/${manifest.files.length})`);
        const res = await fetch(manifest.files[i]);
        if (!res.ok) throw new Error(`Failed to fetch ${manifest.files[i]}`);
        buffers.push(await res.arrayBuffer());
      }

      // Step 4: Merge buffers
      const mergedBuffer = this.mergeBuffers(buffers);

      // Step 5: Unpack
      this.onUpdateLoading("Unpacking game files...");
      await this.unpackFSGAME(mergedBuffer);

      // Step 6: Launch game
      this.onUpdateLoading("Starting game...");
      
      // Use the /player/ prefix that the service worker intercepts
      gameFrameEl.src = "/player/index.html";

      // Remove background blur when the game loads
      gameFrameEl.onload = () => {
        const bgLayer = document.getElementById("bg-blur-layer");
        if (bgLayer) bgLayer.remove();
        console.log("🎮 Game loaded successfully!");
      };

      // Handle iframe load errors
      gameFrameEl.onerror = () => {
        console.error("❌ Failed to load game in iframe");
        this.onUpdateLoading("❌ Failed to load game");
      };

    } catch (err) {
      console.error("❌ FSGAME Player error:", err);
      if (this.onUpdateLoading)
        this.onUpdateLoading(`❌ ${err.message}`);
    }
  }

  // Merge multiple ArrayBuffers into one
  static mergeBuffers(buffers) {
    const totalSize = buffers.reduce((sum, b) => sum + b.byteLength, 0);
    const merged = new Uint8Array(totalSize);
    let offset = 0;
    for (const buf of buffers) {
      merged.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }
    return merged.buffer;
  }

  // Unpack FSGAME archive and save files to IndexedDB
  static async unpackFSGAME(arrayBuffer) {
    const DB_NAME = "fsgame_storage";
    const STORE_NAME = "files";

    const openDB = () => new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore(STORE_NAME);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });

    const saveFile = async (path, data) => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(data, path);
        tx.oncomplete = resolve;
        tx.onerror = reject;
      });
    };

    const dv = new DataView(arrayBuffer);
    let offset = 0;
    const version = dv.getUint32(offset, true); offset += 4;
    const fileCount = dv.getUint32(offset, true); offset += 4;
    console.log(`📜 Archive version ${version}, files: ${fileCount}`);

    for (let i = 0; i < fileCount; i++) {
      const nameLen = dv.getUint16(offset, true); offset += 2;
      const nameBytes = new Uint8Array(arrayBuffer, offset, nameLen); offset += nameLen;
      const name = new TextDecoder().decode(nameBytes);

      const compSize = dv.getUint32(offset, true); offset += 4;
      const origSize = dv.getUint32(offset, true); offset += 4;
      offset += 4; // timestamp

      const compData = new Uint8Array(arrayBuffer, offset, compSize); offset += compSize;
      const inflated = pako.inflate(compData);

      let type = "application/octet-stream";
      if (name.endsWith(".html")) type = "text/html";
      else if (name.endsWith(".js")) type = "text/javascript";
      else if (name.endsWith(".json")) type = "application/json";
      else if (name.endsWith(".css")) type = "text/css";
      else if (name.endsWith(".png")) type = "image/png";
      else if (name.endsWith(".jpg") || name.endsWith(".jpeg")) type = "image/jpeg";
      else if (name.endsWith(".wasm")) type = "application/wasm";
      else if (name.endsWith(".svg")) type = "image/svg+xml";
      else if (name.endsWith(".gif")) type = "image/gif";
      else if (name.endsWith(".mp3")) type = "audio/mpeg";
      else if (name.endsWith(".wav")) type = "audio/wav";
      else if (name.endsWith(".ogg")) type = "audio/ogg";
      else if (name.endsWith(".webm")) type = "video/webm";
      else if (name.endsWith(".mp4")) type = "video/mp4";

      await saveFile(name, new Blob([inflated], { type }));

      if (this.onUpdateLoading)
        this.onUpdateLoading(`Waiting for game... (${i + 1}/${fileCount})`);
    }

    console.log("✅ Unpack complete! Files saved to IndexedDB.");
  }
}
