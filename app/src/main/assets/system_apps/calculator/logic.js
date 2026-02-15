return {
    mount: (sys) => {
        // 1. INJECT STYLE (CSS KHUSUS CALCULATOR)
        const styleId = "calc-style";
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                .calc-wrapper {
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    background: #0f0f1a;
                    padding: 20px;
                    box-sizing: border-box;
                    color: #fff;
                    font-family: 'Segoe UI', sans-serif;
                }
                .calc-header {
                    display: flex;
                    align-items: center;
                    margin-bottom: 20px;
                }
                .calc-back-btn {
                    background: none;
                    border: none;
                    color: #ef4444;
                    font-size: 24px;
                    margin-right: 15px;
                    cursor: pointer;
                }
                .calc-screen {
                    background: #1a1a2e;
                    border: 1px solid #333;
                    border-radius: 15px;
                    padding: 20px;
                    text-align: right;
                    font-size: 3rem;
                    margin-bottom: 20px;
                    height: 100px;
                    display: flex;
                    align-items: center;
                    justify-content: flex-end;
                    overflow-x: auto;
                    box-shadow: inset 0 0 20px rgba(0,0,0,0.5);
                    color: #54d7f6;
                }
                .calc-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 15px;
                    flex: 1;
                }
                .calc-btn {
                    background: #252540;
                    border: none;
                    border-radius: 12px;
                    font-size: 1.5rem;
                    color: #fff;
                    cursor: pointer;
                    transition: transform 0.1s, background 0.2s;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                }
                .calc-btn:active {
                    transform: scale(0.95);
                }
                .btn-op {
                    background: #3a3962;
                    color: #54d7f6;
                    font-weight: bold;
                }
                .btn-eq {
                    background: linear-gradient(135deg, #706bf3, #54d7f6);
                    grid-column: span 2;
                    font-weight: bold;
                    color: #000;
                }
                .btn-clr {
                    color: #ef4444;
                    background: #2a1a1a;
                }
            `;
            document.head.appendChild(style);
        }

        // 2. RENDER UI
        sys.root.innerHTML = `
            <div class="calc-wrapper">
                <div class="calc-header">
                    <button id="calc-back" class="calc-back-btn"><i class="mdi mdi-arrow-left"></i></button>
                    <h3>System Calculator</h3>
                </div>

                <div class="calc-screen" id="calc-display">0</div>

                <div class="calc-grid">
                    <button class="calc-btn btn-clr" data-val="C">C</button>
                    <button class="calc-btn btn-op" data-val="/">÷</button>
                    <button class="calc-btn btn-op" data-val="*">×</button>
                    <button class="calc-btn btn-op" data-val="DEL">⌫</button>

                    <button class="calc-btn" data-val="7">7</button>
                    <button class="calc-btn" data-val="8">8</button>
                    <button class="calc-btn" data-val="9">9</button>
                    <button class="calc-btn btn-op" data-val="-">-</button>

                    <button class="calc-btn" data-val="4">4</button>
                    <button class="calc-btn" data-val="5">5</button>
                    <button class="calc-btn" data-val="6">6</button>
                    <button class="calc-btn btn-op" data-val="+">+</button>

                    <button class="calc-btn" data-val="1">1</button>
                    <button class="calc-btn" data-val="2">2</button>
                    <button class="calc-btn" data-val="3">3</button>
                    <button class="calc-btn btn-eq" data-val="=">=</button>

                    <button class="calc-btn" data-val="0" style="grid-column: span 2">0</button>
                    <button class="calc-btn" data-val=".">.</button>
                </div>
            </div>
        `;

        // 3. LOGIC APP
        const display = document.getElementById('calc-display');
        let currentExpr = "";

        const updateDisplay = (val) => {
            display.textContent = val || "0";
        };

        // Handle Back Button
        document.getElementById('calc-back').onclick = () => {
            sys.goHome();
        };

        // Handle Calculator Buttons
        const buttons = document.querySelectorAll('.calc-btn');
        buttons.forEach(btn => {
            btn.onclick = () => {
                const val = btn.getAttribute('data-val');

                if (val === 'C') {
                    currentExpr = "";
                    updateDisplay("0");
                } else if (val === 'DEL') {
                    currentExpr = currentExpr.slice(0, -1);
                    updateDisplay(currentExpr);
                } else if (val === '=') {
                    try {
                        // Ganti simbol visual dengan operator JS
                        // Note: eval aman di sini karena input terkontrol dari tombol UI saja
                        const safeExpr = currentExpr;
                        if (!safeExpr) return;

                        const result = eval(safeExpr);

                        // Format hasil biar ga kepanjangan desimalnya
                        let finalRes = String(parseFloat(result.toFixed(8)));

                        currentExpr = finalRes;
                        updateDisplay(finalRes);
                    } catch (e) {
                        updateDisplay("Error");
                        setTimeout(() => {
                            currentExpr = "";
                            updateDisplay("0");
                        }, 1000);
                    }
                } else {
                    // Mencegah operator ganda di awal
                    if (currentExpr === "" && ['/','*','+','-'].includes(val)) return;
                    currentExpr += val;
                    updateDisplay(currentExpr);
                }
            };
        });
    }
};