return {
    intervalId: null,

    mount: function(sys) {
        // 1. Inject CSS untuk styling khusus aplikasi ini
        const style = document.createElement('style');
        style.id = 'binary-clock-style';
        style.innerHTML = `
            .bin-container { display: flex; gap: 20px; justify-content: center; align-items: center; height: 100vh; background: #050505; color: #0f0; font-family: monospace; }
            .column { display: flex; flex-direction: column; gap: 10px; align-items: center; }
            .bit { width: 40px; height: 40px; border-radius: 5px; background: #222; transition: all 0.3s; box-shadow: 0 0 5px rgba(0,0,0,0.5); }
            .bit.active { background: #0f0; box-shadow: 0 0 15px #0f0; }
            .label { font-size: 24px; font-weight: bold; margin-top: 20px; }
            .separator { width: 2px; height: 200px; background: #333; }
            .back-btn { position: absolute; top: 20px; left: 20px; padding: 10px 20px; border: 1px solid #0f0; color: #0f0; background: transparent; cursor: pointer; border-radius: 5px; font-weight: bold; z-index: 100; }
            .back-btn:hover { background: #0f0; color: #000; }
        `;
        sys.root.appendChild(style);

        // 2. Render HTML Structure
        sys.root.innerHTML = `
            <button class="back-btn" onclick="sys.goHome()">← EXIT SYSTEM</button>
            <div class="bin-container">
                <div class="column" id="col-h"></div>
                <div class="separator"></div>
                <div class="column" id="col-m"></div>
                <div class="separator"></div>
                <div class="column" id="col-s"></div>
            </div>
        `;

        // 3. Helper Functions
        const createBits = (id, count) => {
            const el = document.getElementById(id);
            for(let i=0; i<count; i++) {
                const bit = document.createElement('div');
                bit.className = 'bit';
                el.appendChild(bit);
            }
            const lbl = document.createElement('div');
            lbl.className = 'label';
            lbl.id = `lbl-${id.split('-')[1]}`;
            el.appendChild(lbl);
        };

        // Buat 6 bit kolom untuk Jam, Menit, Detik
        createBits('col-h', 6);
        createBits('col-m', 6);
        createBits('col-s', 6);

        const updateClock = () => {
            const now = new Date();
            const time = [now.getHours(), now.getMinutes(), now.getSeconds()];
            const cols = ['col-h', 'col-m', 'col-s'];

            time.forEach((val, idx) => {
                // Update Label Angka
                document.getElementById(`lbl-${cols[idx].split('-')[1]}`).innerText = val.toString().padStart(2, '0');

                // Update Binary Bits
                const bin = val.toString(2).padStart(6, '0'); // Convert ke binary string
                const container = document.getElementById(cols[idx]);
                const bits = container.getElementsByClassName('bit');

                for(let i=0; i<6; i++) {
                    if(bin[i] === '1') bits[i].classList.add('active');
                    else bits[i].classList.remove('active');
                }
            });
        };

        // 4. Start Interval
        updateClock();
        this.intervalId = setInterval(updateClock, 1000);
    },

    unmount: function() {
        // Bersihkan interval agar tidak jadi Zombie process
        if (this.intervalId) clearInterval(this.intervalId);

        // Hapus style yang di-inject
        const s = document.getElementById('binary-clock-style');
        if(s) s.remove();

        console.log("Binary Clock Unmounted");
    }
};