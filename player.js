export class FSGAMEPlayer {

  // Callback to update loader text
  static onUpdateLoading = null;

  // Load game from a manifest.json URL
  static async loadFromManifest(manifestUrl) {
    const loadingTextEl = document.getElementById("loading-text");
    const gameFrameEl = document.getElementById("game-frame");

    if (!loadingTextEl || !gameFrameEl) {
      throw new Error("FSGAME Player: Required DOM elements not found.");
    }

    // Default callback if none provided
    if (!this.onUpdateLoading) this.onUpdateLoading = (msg) => {
      loadingTextEl.textContent = msg;
    };

    try {
      // Fetch manifest
      this.onUpdateLoading("Fetching manifest...");
      const manifest = await fetch(manifestUrl).then(r => r.json());
      if (!manifest.files || !manifest.files.length)
        throw new Error("Manifest missing 'files' array.");

      // Set background image if available
      if (manifest.image) {
        document.body.style.backgroundImage = `url(${manifest.image})`;
        document.body.style.backgroundSize = "cover";
        document.body.style.backgroundPosition = "center";
        document.body.style.backgroundRepeat = "no-repeat";
      }

      // Download files
      const buffers = [];
      for (let i = 0; i < manifest.files.length; i++) {
        const url = manifest.files[i];
        this.onUpdateLoading(`Fetching data... (${i + 1}/${manifest.files.length})`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch ${url}`);
        const buf = await res.arrayBuffer();
        buffers.push(buf);
      }

      // Merge buffers
      const mergedBuffer = this.mergeBuffers(buffers);

      // Unpack
      this.onUpdateLoading("Waiting for game...");
      await this.unpackFSGAME(mergedBuffer);

      // Launch game
      gameFrameEl.style.display = "block";
      gameFrameEl.src = "index.html"; // first HTML inside FSGAME archive

      // Hide spinner container
      const loader = document.getElementById("loading-container");
      if (loader) loader.style.display = "none";
      document.body.classList.remove("loading");

      console.log("🎮 Game loaded successfully!");

    } catch (err) {
      console.error("❌ FSGAME Player error:", err);
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

      await saveFile(name, new Blob([inflated], { type }));

      if (this.onUpdateLoading)
        this.onUpdateLoading(`Waiting for game... (${i + 1}/${fileCount})`);
    }

    console.log("✅ Unpack complete!");
  }
}
