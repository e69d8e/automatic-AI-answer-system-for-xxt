// ==UserScript==
// @name         学习通AI自动答题
// @namespace    http://tampermonkey.net/
// @version      1.1.3
// @description  调用DeepSeek/MiMo AI自动完成学习通作业和考试题目
// @author       You
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      api.deepseek.com
// @connect      api.xiaomimimo.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 配置 ====================
    const CONFIG = {
        // AI 提供商: 'deepseek' | 'mimo'
        provider: GM_getValue('provider', 'deepseek'),
        // DeepSeek API Key
        deepseekKey: GM_getValue('deepseekKey', ''),
        // MiMo API Key
        mimoKey: GM_getValue('mimoKey', ''),
        // 自定义 API Endpoint（留空使用默认）
        customEndpoint: GM_getValue('customEndpoint', ''),
        // DeepSeek 模型
        deepseekModel: GM_getValue('deepseekModel', 'deepseek-v4-pro'),
        // MiMo 模型
        mimoModel: GM_getValue('mimoModel', 'mimo-v2.5-pro'),
        // 答题间隔（毫秒）
        delay: GM_getValue('delay', 2000),
        // 自动提交
        autoSubmit: GM_getValue('autoSubmit', false),
        // 流式输出
        stream: GM_getValue('stream', true),
    };

    // API 端点
    const ENDPOINTS = {
        deepseek: 'https://api.deepseek.com/chat/completions',
        mimo: 'https://api.xiaomimimo.com/v1/chat/completions',
    };

    // ==================== 全局防崩溃拦截器 ====================
    // 拦截学习通自带的 loadEditorAnswerd 和 UEditor 的报错
    setInterval(() => {
        const patchLoadEditor = (win) => {
            try {
                if (win.loadEditorAnswerd && !win.loadEditorAnswerd._patched) {
                    const orig = win.loadEditorAnswerd;
                    win.loadEditorAnswerd = function() {
                        try { return orig.apply(this, arguments); } catch (e) {}
                    };
                    win.loadEditorAnswerd._patched = true;
                }
            } catch (e) {}
        };
        const patchUE = (win) => {
            try {
                if (win.UE && win.UE.Editor && win.UE.Editor.prototype && !win.UE._patchedByAI) {
                    const origHasContents = win.UE.Editor.prototype.hasContents;
                    win.UE.Editor.prototype.hasContents = function(tags) {
                        try { return origHasContents.call(this, tags); } catch (e) { return true; }
                    };
                    const origGetContent = win.UE.Editor.prototype.getContent;
                    win.UE.Editor.prototype.getContent = function() {
                        try { return origGetContent.apply(this, arguments); } catch (e) { return this.body ? this.body.innerHTML : ''; }
                    };
                    win.UE._patchedByAI = true;
                }
            } catch (e) {}
        };

        try { if (typeof unsafeWindow !== 'undefined') { patchLoadEditor(unsafeWindow); patchUE(unsafeWindow); } } catch(e) {}
        try { patchLoadEditor(window); patchUE(window); } catch(e) {}
        
        document.querySelectorAll('iframe').forEach(f => {
            try { 
                if (f.contentWindow) {
                    patchLoadEditor(f.contentWindow);
                    patchUE(f.contentWindow);
                }
            } catch(e) {}
        });
    }, 1000);

    // 题型映射
    const QUESTION_TYPES = {
        0: '单选题',
        1: '多选题',
        2: '判断题',
        3: '填空题',
        4: '简答题',
        5: '论述题',
        6: '计算题',
        7: '问答题',
    };

    // ==================== 样式 ====================
    // DESIGN.md tokens
    const C = {
        primary:       '#cc785c',
        primaryActive: '#a9583e',
        primaryDisabled:'#e6dfd8',
        ink:           '#141413',
        body:          '#3d3d3a',
        bodyStrong:    '#252523',
        muted:         '#6c6a64',
        mutedSoft:     '#8e8b82',
        hairline:      '#e6dfd8',
        hairlineSoft:  '#ebe6df',
        canvas:        '#faf9f5',
        surfaceSoft:   '#f5f0e8',
        surfaceCard:   '#efe9de',
        surfaceCreamStrong:'#e8e0d2',
        surfaceDark:   '#181715',
        surfaceDarkElevated:'#252320',
        surfaceDarkSoft:'#1f1e1b',
        onPrimary:     '#ffffff',
        onDark:        '#faf9f5',
        onDarkSoft:    '#a09d96',
        accentTeal:    '#5db8a6',
        accentAmber:   '#e8a55a',
        success:       '#5db872',
        warning:       '#d4a017',
        error:         '#c64545',
    };

    GM_addStyle(`
        #ai-answer-panel {
            position: fixed;
            top: 60px;
            right: 20px;
            width: 320px;
            background: ${C.canvas};
            border: 1px solid ${C.hairlineSoft};
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(20,20,19,0.08), 0 4px 24px rgba(20,20,19,0.06);
            z-index: 999999;
            font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            color: ${C.body};
            overflow: hidden;
            transition: all 0.3s ease;
        }
        #ai-answer-panel.collapsed {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            cursor: pointer;
            overflow: hidden;
            border-color: ${C.hairline};
        }
        #ai-answer-panel.collapsed .panel-body,
        #ai-answer-panel.collapsed .panel-header span,
        #ai-answer-panel.collapsed .panel-header .panel-controls {
            display: none;
        }
        #ai-answer-panel.collapsed .panel-header {
            padding: 12px;
            justify-content: center;
        }
        .panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            background: ${C.surfaceDark};
            color: ${C.onDark};
            cursor: move;
        }
        .panel-header span {
            font-weight: 600;
            font-size: 15px;
            letter-spacing: 0;
        }
        .panel-controls {
            display: flex;
            gap: 8px;
        }
        .panel-controls button {
            background: ${C.surfaceDarkElevated};
            border: none;
            color: ${C.onDark};
            width: 28px;
            height: 28px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s ease;
        }
        .panel-controls button:hover {
            background: ${C.surfaceDarkSoft};
        }
        .panel-body {
            padding: 16px;
            max-height: 500px;
            overflow-y: auto;
        }
        .config-group {
            margin-bottom: 12px;
        }
        .config-group label {
            display: block;
            font-size: 12px;
            font-weight: 500;
            color: ${C.muted};
            margin-bottom: 4px;
            letter-spacing: 0;
        }
        .config-group label:has(input[type="checkbox"]) {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 14px;
            color: ${C.body};
            cursor: pointer;
            margin-bottom: 0;
        }
        .config-group label:has(input[type="checkbox"]) input[type="checkbox"] {
            width: 16px;
            height: 16px;
            accent-color: ${C.primary};
            cursor: pointer;
        }
        .config-group input, .config-group select {
            width: 100%;
            padding: 10px 14px;
            border: 1px solid ${C.hairline};
            border-radius: 8px;
            font-size: 14px;
            font-family: inherit;
            color: ${C.ink};
            background: ${C.canvas};
            box-sizing: border-box;
            transition: border-color 0.15s ease;
        }
        .config-group input:focus, .config-group select:focus {
            border-color: ${C.primary};
            outline: none;
            box-shadow: 0 0 0 3px rgba(204,120,92,0.15);
        }
        .config-group a {
            color: ${C.primary};
        }
        .btn-primary {
            width: 100%;
            padding: 10px 20px;
            background: ${C.primary};
            color: ${C.onPrimary};
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            font-family: inherit;
            cursor: pointer;
            margin-top: 8px;
            transition: background 0.15s ease;
        }
        .btn-primary:hover {
            background: ${C.primaryActive};
        }
        .btn-primary:disabled {
            background: ${C.primaryDisabled};
            color: ${C.muted};
            cursor: not-allowed;
        }
        .btn-secondary {
            width: 100%;
            padding: 10px 20px;
            background: ${C.surfaceSoft};
            color: ${C.ink};
            border: 1px solid ${C.hairlineSoft};
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            font-family: inherit;
            cursor: pointer;
            margin-top: 6px;
            transition: background 0.15s ease;
        }
        .btn-secondary:hover {
            background: ${C.surfaceCard};
        }
        .log-area {
            margin-top: 12px;
            max-height: 200px;
            overflow-y: auto;
            background: ${C.surfaceSoft};
            border: 1px solid ${C.hairlineSoft};
            border-radius: 8px;
            padding: 10px;
            font-size: 12px;
            font-family: 'JetBrains Mono', ui-monospace, monospace;
            line-height: 1.6;
            color: ${C.body};
        }
        .log-area .log-item {
            padding: 2px 0;
            border-bottom: 1px solid ${C.hairlineSoft};
        }
        .log-area .log-item:last-child {
            border-bottom: none;
        }
        .log-success { color: ${C.success}; }
        .log-error { color: ${C.error}; }
        .log-info { color: ${C.accentTeal}; }
        .log-warn { color: ${C.warning}; }
        .progress-bar {
            height: 4px;
            background: ${C.surfaceCreamStrong};
            border-radius: 2px;
            margin-top: 8px;
            overflow: hidden;
        }
        .progress-bar-fill {
            height: 100%;
            background: ${C.primary};
            border-radius: 2px;
            transition: width 0.3s ease;
            width: 0%;
        }
        .tab-bar {
            display: flex;
            border-bottom: 1px solid ${C.hairlineSoft};
            margin-bottom: 12px;
        }
        .tab-bar button {
            flex: 1;
            padding: 8px 14px;
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            font-family: inherit;
            color: ${C.muted};
            transition: color 0.15s ease, border-color 0.15s ease;
        }
        .tab-bar button.active {
            color: ${C.ink};
            border-bottom-color: ${C.primary};
        }
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }
        .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 500;
        }
        .status-badge.ready { background: ${C.surfaceCard}; color: ${C.success}; }
        .status-badge.running { background: ${C.surfaceCard}; color: ${C.accentTeal}; }
        .status-badge.error { background: ${C.surfaceCard}; color: ${C.error}; }
        .ai-toast {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%) translateY(-20px);
            background: ${C.surfaceDark};
            color: ${C.onDark};
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-shadow: 0 4px 24px rgba(20,20,19,0.15);
            z-index: 9999999;
            opacity: 0;
            transition: opacity 0.25s ease, transform 0.25s ease;
            pointer-events: none;
        }
        .ai-toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
    `);

    function showToast(msg, duration) {
        duration = duration || 2000;
        let toast = document.querySelector('.ai-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'ai-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
    }

    // ==================== 日志系统 ====================
    const Logger = {
        _el: null,
        init(el) { this._el = el; },
        _add(msg, type = 'info') {
            if (!this._el) return;
            const item = document.createElement('div');
            item.className = `log-item log-${type}`;
            const time = new Date().toLocaleTimeString();
            item.textContent = `[${time}] ${msg}`;
            this._el.appendChild(item);
            this._el.scrollTop = this._el.scrollHeight;
            console.log(`[AI答题 ${type}] ${msg}`);
        },
        info(msg) { this._add(msg, 'info'); },
        success(msg) { this._add(msg, 'success'); },
        warn(msg) { this._add(msg, 'warn'); },
        error(msg) { this._add(msg, 'error'); },
        clear() { if (this._el) this._el.innerHTML = ''; },
    };

    // ==================== 工具函数 ====================
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getApiKey() {
        if (CONFIG.provider === 'deepseek') return CONFIG.deepseekKey;
        if (CONFIG.provider === 'mimo') return CONFIG.mimoKey;
        return '';
    }

    function getEndpoint() {
        if (CONFIG.customEndpoint) return CONFIG.customEndpoint;
        return ENDPOINTS[CONFIG.provider] || ENDPOINTS.deepseek;
    }

    function getModel() {
        if (CONFIG.provider === 'deepseek') return CONFIG.deepseekModel;
        if (CONFIG.provider === 'mimo') return CONFIG.mimoModel;
        return 'deepseek-chat';
    }

    // ==================== 字体解密 ====================
    // 学习通使用 font-cxsecret 字体混淆，需要解码
    const FontDecryptor = {
        _map: null,

        async init() {
            try {
                // 尝试从页面提取字体映射
                const styleSheets = document.styleSheets;
                for (const sheet of styleSheets) {
                    try {
                        for (const rule of sheet.cssRules) {
                            if (rule instanceof CSSFontFaceRule && rule.cssText.includes('font-cxsecret')) {
                                // 找到了字体规则，但实际解码需要 Typr.js
                                // 这里用简单的 DOM 文本对比方法
                                Logger.info('检测到字体混淆，尝试解码...');
                                this._buildMap();
                                return;
                            }
                        }
                    } catch (e) {
                        // 跨域 stylesheet 无法读取，跳过
                    }
                }
            } catch (e) {
                Logger.warn('字体解密初始化失败: ' + e.message);
            }
        },

        _buildMap() {
            // 创建隐藏容器来对比渲染文本
            const testDiv = document.createElement('div');
            testDiv.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;';
            document.body.appendChild(testDiv);

            // 获取页面中所有 font-cxsecret 元素的实际渲染文本
            const cxElements = document.querySelectorAll('.font-cxsecret');
            this._map = new Map();

            // 使用 Range API 获取实际渲染的字符
            cxElements.forEach(el => {
                const text = el.textContent;
                const rendered = this._getRenderedText(el);
                if (text && rendered && text !== rendered) {
                    for (let i = 0; i < Math.min(text.length, rendered.length); i++) {
                        if (text[i] !== rendered[i]) {
                            this._map.set(text[i], rendered[i]);
                        }
                    }
                }
            });

            document.body.removeChild(testDiv);
            if (this._map.size > 0) {
                Logger.success(`字体解密完成，映射 ${this._map.size} 个字符`);
            }
        },

        _getRenderedText(el) {
            // 尝试通过 selection API 获取实际渲染文本
            try {
                const range = document.createRange();
                range.selectNodeContents(el);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                const text = selection.toString();
                selection.removeAllRanges();
                return text;
            } catch (e) {
                return el.textContent;
            }
        },

        decrypt(text) {
            if (!this._map || this._map.size === 0) return text;
            let result = '';
            for (const char of text) {
                result += this._map.get(char) || char;
            }
            return result;
        }
    };

    // ==================== DOM 解析器 ====================
    const DomParser = {
        // 获取所有题目所在的 iframe 文档
        _getDocs() {
            const docs = [document];
            const iframes = document.querySelectorAll('iframe');
            for (const iframe of iframes) {
                try {
                    if (iframe.contentDocument) {
                        docs.push(iframe.contentDocument);
                        // 递归查找嵌套 iframe
                        const nestedIframes = iframe.contentDocument.querySelectorAll('iframe');
                        for (const nested of nestedIframes) {
                            try {
                                if (nested.contentDocument) {
                                    docs.push(nested.contentDocument);
                                }
                            } catch (e) {}
                        }
                    }
                } catch (e) {
                    // 跨域 iframe 无法访问
                }
            }
            return docs;
        },

        // 查找包含题目的文档
        _findQuestionDoc() {
            const docs = this._getDocs();
            for (const doc of docs) {
                const selectors = [
                    '.questionLi',
                    '.TiMu .mark_name',
                    '.tiMu .mark_name',
                    '.mark_name',
                    '[typename]',
                    'input[name^="answertype"]'
                ];
                for (const sel of selectors) {
                    if (doc.querySelectorAll(sel).length > 0) {
                        return doc;
                    }
                }
            }
            return null;
        },

        // 获取所有题目
        getQuestions() {
            const doc = this._findQuestionDoc();
            if (!doc) {
                Logger.warn('未找到题目容器，请确认当前页面有题目');
                return [];
            }

            const questions = [];

            // 尝试多种选择器
            let questionElements = doc.querySelectorAll('.questionLi');
            if (questionElements.length === 0) {
                // 备选：通过 typename 属性查找
                questionElements = doc.querySelectorAll('[typename]');
            }
            if (questionElements.length === 0) {
                // 备选：通过 answertype input 查找父容器
                const typeInputs = doc.querySelectorAll('input[name^="answertype"]');
                questionElements = Array.from(typeInputs).map(input => {
                    return input.closest('.questionLi') || input.closest('.TiMu') || input.parentElement;
                }).filter(Boolean);
            }

            Logger.info(`找到 ${questionElements.length} 个题目元素，开始解析...`);

            let skipped = 0;
            let parsed = 0;
            let errors = 0;

            questionElements.forEach((el, index) => {
                try {
                    const question = this._parseQuestion(el, index);
                    if (question) {
                        questions.push(question);
                        parsed++;
                    } else {
                        skipped++;
                        if (skipped <= 5) {
                            Logger.warn(`跳过第 ${index + 1} 题: _parseQuestion 返回 null`);
                        }
                    }
                } catch (e) {
                    errors++;
                    Logger.error(`解析第 ${index + 1} 题失败: ${e.message}`);
                }
            });

            Logger.info(`解析完成: 成功=${parsed}, 跳过=${skipped}, 错误=${errors}`);
            return questions;
        },

        // 解析单个题目
        _parseQuestion(el, index) {
            // 获取题型 - 多种方式
            let answerType = -1;
            let typeName = el.getAttribute('typename') || '';

            // 方式1: 从 input[name^="answertype"] 获取
            const typeInput = el.querySelector('input[name^="answertype"]') ||
                              el.parentElement?.querySelector('input[name^="answertype"]');
            if (typeInput) {
                answerType = parseInt(typeInput.value);
            }

            // 方式2: 从 typename 属性获取
            if (answerType === -1 && typeName) {
                for (const [code, name] of Object.entries(QUESTION_TYPES)) {
                    if (typeName.includes(name)) {
                        answerType = parseInt(code);
                        break;
                    }
                }
            }

            // 方式3: 从 h2.type_tit 或周围的标题推断
            if (answerType === -1) {
                const sectionTitle = el.closest('.TiMu')?.querySelector('h2.type_tit')?.textContent || '';
                const fullText = sectionTitle + ' ' + el.textContent;
                if (fullText.includes('单选')) answerType = 0;
                else if (fullText.includes('多选')) answerType = 1;
                else if (fullText.includes('判断')) answerType = 2;
                else if (fullText.includes('填空')) answerType = 3;
                else if (fullText.includes('简答')) answerType = 4;
                else if (fullText.includes('论述')) answerType = 5;
                else if (fullText.includes('计算')) answerType = 6;
                else if (fullText.includes('问答')) answerType = 7;
            }

            // 方式4: 从 DOM 结构推断
            if (answerType === -1) {
                const hasOptions = el.querySelectorAll('.answerBg').length > 0;
                // 查找填空元素：先在 el 内部找，再在兄弟/.TiMu 父级找
                let hasBlanks = el.querySelectorAll(
                    '.Answer textarea, .Answer .tiankong, .Answer input[type="text"], ' +
                    '.blank_box input, .tkInput, input.cloze, .cloze input, ' +
                    '[class*="fillblank"] input, [class*="tiankong"] input, ' +
                    '.mark_name input[type="text"], .mark_name textarea'
                ).length > 0;

                // 如果内部找不到，查找兄弟节点
                if (!hasBlanks) {
                    let sib = el.nextElementSibling;
                    while (sib && !hasBlanks) {
                        if (sib.classList.contains('questionLi') || sib.classList.contains('TiMu')) break;
                        
                        // 查找兄弟节点本身或是其内部的元素
                        const elementsToCheck = [sib, ...Array.from(sib.querySelectorAll('.Answer, [class*="blank"]'))];
                        for (const target of elementsToCheck) {
                            if (target.classList.contains('Answer') || target.tagName === 'TEXTAREA' || target.tagName === 'IFRAME') {
                                hasBlanks = true;
                                break;
                            }
                        }
                        sib = sib.nextElementSibling;
                    }
                }
                // 再查父元素
                if (!hasBlanks) {
                    const timu = el.closest('.TiMu') || el.parentElement;
                    if (timu) {
                        hasBlanks = timu.querySelectorAll('.Answer textarea, .Answer iframe, .Answer [contenteditable]').length > 0;
                    }
                }

                if (hasOptions && !hasBlanks) {
                    const optCount = el.querySelectorAll('.answerBg').length;
                    answerType = optCount === 2 ? 2 : 0;
                } else if (hasBlanks && !hasOptions) {
                    answerType = 3; // 填空题
                } else if (hasBlanks && hasOptions) {
                    answerType = 0; // 有选项有填空，默认选择题
                }
            }

            if (!typeName && answerType >= 0) {
                typeName = QUESTION_TYPES[answerType] || '未知';
            }

            // 【关键修复】处理 answerType 与 typeName 冲突的问题
            // 某些页面 input[name="answertype"] 的值可能不符合默认映射
            if (typeName.includes('单选')) answerType = 0;
            else if (typeName.includes('多选')) answerType = 1;
            else if (typeName.includes('判断')) answerType = 2;
            else if (typeName.includes('填空')) answerType = 3;
            else if (typeName.includes('简答')) answerType = 4;
            else if (typeName.includes('论述')) answerType = 5;
            else if (typeName.includes('计算')) answerType = 6;
            else if (typeName.includes('问答')) answerType = 7;



            // Logger.info(`[诊断] 解析题目第 ${index+1} 题: 修正后 answerType=${answerType}, typeName=${typeName}`);

            // 获取题目文本 - 多种选择器
            const titleEl = el.querySelector('h3.mark_name') ||
                           el.querySelector('.mark_name') ||
                           el.querySelector('h3') ||
                           el.querySelector('.questionTitle') ||
                           el.querySelector('[class*="title"]');
            let titleText = '';
            if (titleEl) {
                titleText = titleEl.textContent.trim()
                    .replace(/^\d+[.、．]\s*/, '')
                    .replace(/\(.*?\)\s*$/, '')
                    .replace(/（.*?）\s*$/, '');
                titleText = FontDecryptor.decrypt(titleText);
            }

            // 如果清理后标题为空，使用原始文本
            if (!titleText && titleEl) {
                titleText = titleEl.textContent.trim();
            }

            if (!titleText) {
                Logger.warn(`题目${index + 1}无法获取标题`);
                return null;
            }

            // 获取选项（选择题/判断题）- 多种选择器
            const options = [];
            const optionSelectors = ['.answerBg', '.answer_li', '[class*="option"]', 'li[data]'];
            let optionElements = [];
            for (const sel of optionSelectors) {
                optionElements = el.querySelectorAll(sel);
                if (optionElements.length > 0) break;
            }

            optionElements.forEach((opt, i) => {
                const labelEl = opt.querySelector('.num_option') ||
                               opt.querySelector('[class*="label"]') ||
                               opt.querySelector('[class*="num"]');
                const textEl = opt.querySelector('.answer_p') ||
                              opt.querySelector('[class*="answer"]') ||
                              opt.querySelector('[class*="content"]') ||
                              opt.querySelector('p');
                let label = labelEl ? labelEl.textContent.trim() : '';
                // 如果没有标签，用字母
                if (!label) label = String.fromCharCode(65 + i);
                let text = textEl ? textEl.textContent.trim() : opt.textContent.trim();
                text = FontDecryptor.decrypt(text);
                options.push({ label, text, element: opt });
            });

            // 获取填空题区域 - 多种选择器（按优先级）
            const blanks = [];
            const blankSelectors = [
                // 填空题专用输入
                '.blank_box input[type="text"]',
                '.blank_box textarea',
                '.tkInput',
                'input.cloze',
                '.cloze input',
                '[class*="fillblank"] input',
                '[class*="tiankong"] input',
                '.Answer input[type="text"]',
                '.Answer textarea',
                '.Answer .tiankong + textarea',
                'textarea[name^="answerEditor"]',
                // UEditor 组件
                '.edui-editor textarea',
                '.edui-body-container',
                '.Answer .edui-body-container',
                // 通用输入
                '.answer_content input[type="text"]',
                '.answer_content textarea',
                'input[type="text"][name*="answer"]',
                'input[type="text"][name*="blank"]',
                '.blank input',
                '[contenteditable="true"]'
            ];

            let blankElements = [];
            for (const sel of blankSelectors) {
                blankElements = el.querySelectorAll(sel);
                if (blankElements.length > 0) {
                    // Logger.info(`通过 ${sel} 找到 ${blankElements.length} 个填空元素`);
                    break;
                }
            }

            blankElements.forEach((container, i) => {
                const vis = container.offsetParent !== null ? '可见' : '隐藏';
                const cls = (container.className || '').toString().substring(0, 30);
                // Logger.info(`  空白[${i}]: <${container.tagName.toLowerCase()}> class="${cls}" ${vis}`);
                blanks.push({ index: i, element: container, tag: container.tagName.toLowerCase() });
            });

            // 如果没找到填空元素，尝试从 .Answer 容器查找（包括兄弟节点）
            if (blanks.length === 0) {
                // 先查 el 内部
                let answerContainers = Array.from(el.querySelectorAll('.Answer, .answer_content, [class*="blank"], [class*="Blank"]'));
                // 再查兄弟节点
                if (answerContainers.length === 0) {
                    let sib = el.nextElementSibling;
                    while (sib) {
                        if (sib.classList.contains('questionLi') || sib.classList.contains('TiMu')) break;
                        
                        // 把兄弟节点本身，以及兄弟节点内的 .Answer 元素都收集起来
                        if (sib.classList.contains('Answer')) {
                            answerContainers.push(sib);
                        } else {
                            const nested = sib.querySelectorAll('.Answer, [class*="blank"]');
                            nested.forEach(a => answerContainers.push(a));
                        }
                        // 甚至直接把兄弟节点当做可能得容器，如果有 textarea/iframe 的话
                        if (sib.querySelector('textarea, iframe, [contenteditable]')) {
                            answerContainers.push(sib);
                        }
                        
                        sib = sib.nextElementSibling;
                    }
                }
                // 再查父元素
                if (answerContainers.length === 0) {
                    const timu = el.closest('.TiMu') || el.parentElement;
                    if (timu) {
                        answerContainers = Array.from(timu.querySelectorAll('.Answer'));
                    }
                }

                answerContainers.forEach((container, i) => {
                    const textarea = container.querySelector('input[type="text"]') ||
                                    container.querySelector('textarea') ||
                                    container.querySelector('.edui-body-container') ||
                                    container.querySelector('[contenteditable]') ||
                                    container.querySelector('iframe');
                    if (textarea) {
                        blanks.push({ index: i, element: textarea, tag: textarea.tagName.toLowerCase() });
                    } else {
                        // 即使容器内没找到具体元素，也把容器本身加进去
                        blanks.push({ index: i, element: container, tag: container.tagName.toLowerCase() });
                    }
                });
                if (blanks.length > 0) {
                    // Logger.info(`从 .Answer 容器（含兄弟）找到 ${blanks.length} 个填空元素`);
                }
            }

            // 如果仍未找到，在题目文本区域查找内联填空输入
            if (blanks.length === 0) {
                const inlineInputs = el.querySelectorAll(
                    '.mark_name input, .mark_name textarea, ' +
                    'h3 input, h3 textarea, ' +
                    '.questionTitle input, .questionTitle textarea, ' +
                    '[class*="title"] input[type="text"], [class*="title"] textarea'
                );
                inlineInputs.forEach((container, i) => {
                    blanks.push({ index: i, element: container, tag: container.tagName.toLowerCase() });
                });
            }

            // 获取隐藏的答案输入
            const questionId = el.getAttribute('data') || el.getAttribute('data-id') || el.getAttribute('id') || '';
            const hiddenAnswer = questionId ? el.querySelector(`#answer${questionId}`) : null;

            // 如果刚才没有执行 DOM 强制修正，现在有了 blanks 信息，再修正一次
            if (blanks.length > 0 && options.length === 0 && answerType !== 3 && answerType !== 4 && answerType !== 5) {
                // Logger.info(`[诊断] 第 ${index+1} 题: 检测到填空框但无选项，强制修正 answerType=${answerType} -> 3`);
                answerType = 3;
                if (!typeName.includes('填空')) typeName = '填空题';
            }

            return {
                index,
                element: el,
                questionId,
                answerType,
                typeName: typeName || QUESTION_TYPES[answerType] || '未知',
                title: titleText,
                options,
                blanks,
                hiddenAnswer,
            };
        },

        // 查找保存/提交按钮
        getSaveButton() {
            const doc = this._findQuestionDoc() || document;
            return doc.querySelector('a[onclick*="saveWork"]') ||
                   doc.querySelector('a:last-child')?.textContent?.includes('保存') ?
                   doc.querySelector('a:last-child') : null;
        },

        getSubmitButton() {
            const doc = this._findQuestionDoc() || document;
            return doc.querySelector('a[onclick*="submitValidate"]') ||
                   doc.querySelector('a:last-child')?.textContent?.includes('提交') ?
                   doc.querySelector('a:last-child') : null;
        }
    };

    // ==================== AI 调用 ====================
    const AIClient = {
        // 构建 prompt
        buildPrompt(question) {
            const typeMap = {
                0: '单选题，只需返回一个正确选项的字母（如 A）',
                1: '多选题，返回所有正确选项的字母，用逗号分隔（如 A,C,D）',
                2: '判断题，只返回 "对" 或 "错"',
                3: '填空题，返回每个空的答案，用 ||| 分隔（如 答案1|||答案2）',
                4: '简答题，返回简洁准确的答案文本',
                5: '论述题，返回详细的论述答案',
                6: '计算题，返回计算过程和最终答案',
                7: '问答题，返回准确的答案文本',
            };

            const type = question.answerType;
            const typeDesc = typeMap[type] || '请返回答案';

            let prompt = `你是一个答题助手，请根据题目直接给出答案，不需要解释。\n\n`;
            prompt += `题型：${question.typeName}\n`;
            prompt += `要求：${typeDesc}\n\n`;
            prompt += `题目：${question.title}\n`;

            if (question.options.length > 0) {
                prompt += `\n选项：\n`;
                question.options.forEach(opt => {
                    prompt += `${opt.label}. ${opt.text}\n`;
                });
            }

            if (type === 3 && question.blanks.length > 0) {
                prompt += `\n共有 ${question.blanks.length} 个空需要填写\n`;
            }

            prompt += `\n请直接返回答案，不要包含任何其他文字、标点或解释。`;

            return prompt;
        },

        // 调用 AI API（非流式）
        async call(prompt) {
            const apiKey = getApiKey();
            if (!apiKey) {
                throw new Error(`未配置 ${CONFIG.provider === 'deepseek' ? 'DeepSeek' : 'MiMo'} API Key`);
            }

            const endpoint = getEndpoint();
            const model = getModel();

            return new Promise((resolve, reject) => {
                const xhr = GM_xmlhttpRequest({
                    method: 'POST',
                    url: endpoint,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    data: JSON.stringify({
                        model: model,
                        messages: [
                            {
                                role: 'system',
                                content: '你是一个精准的答题助手，只返回答案，不返回任何解释、标点或多余文字。选择题只返回选项字母，判断题只返回"对"或"错"，填空题用|||分隔多个答案。'
                            },
                            {
                                role: 'user',
                                content: prompt,
                            }
                        ],
                        temperature: 0.1,
                        max_tokens: 2048,
                        stream: false,
                    }),
                    onload: function(response) {
                        try {
                            if (response.status !== 200) {
                                reject(new Error(`API 请求失败 (${response.status}): ${response.responseText}`));
                                return;
                            }
                            const data = JSON.parse(response.responseText);
                            const content = data.choices?.[0]?.message?.content?.trim();
                            if (!content) {
                                reject(new Error('AI 返回内容为空'));
                                return;
                            }
                            resolve(content);
                        } catch (e) {
                            reject(new Error(`解析 AI 响应失败: ${e.message}`));
                        }
                    },
                    onerror: function(error) {
                        const detail = error.error || error.statusText || error.responseText || '请检查网络连接和API地址是否正确';
                        reject(new Error(`网络请求失败: ${detail}`));
                    },
                    ontimeout: function() {
                        reject(new Error('API 请求超时'));
                    },
                    timeout: 30000,
                });
                Controller._currentXHR = xhr;
            });
        },

        // 解析 SSE 格式响应
        _parseSSE(responseText) {
            let content = '';
            const lines = responseText.split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                        const data = JSON.parse(line.slice(6));
                        const delta = data.choices?.[0]?.delta?.content;
                        if (delta) content += delta;
                    } catch (e) {}
                }
            }
            return content;
        },

        // 调用 AI API（流式）
        async callStream(prompt, onChunk) {
            const apiKey = getApiKey();
            if (!apiKey) {
                throw new Error(`未配置 ${CONFIG.provider === 'deepseek' ? 'DeepSeek' : 'MiMo'} API Key`);
            }

            const endpoint = getEndpoint();
            const model = getModel();

            return new Promise((resolve, reject) => {
                let fullContent = '';
                let settled = false;

                const done = (value) => {
                    if (settled) return;
                    settled = true;
                    resolve(value);
                };

                const fail = (err) => {
                    if (settled) return;
                    settled = true;
                    reject(err);
                };

                const xhr = GM_xmlhttpRequest({
                    method: 'POST',
                    url: endpoint,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    data: JSON.stringify({
                        model: model,
                        messages: [
                            {
                                role: 'system',
                                content: '你是一个精准的答题助手，只返回答案，不返回任何解释、标点或多余文字。选择题只返回选项字母，判断题只返回"对"或"错"，填空题用|||分隔多个答案。'
                            },
                            {
                                role: 'user',
                                content: prompt,
                            }
                        ],
                        temperature: 0.1,
                        max_tokens: 2048,
                        stream: true,
                    }),
                    onload: function(response) {
                        // 响应完成：可能是 SSE 流式格式，也可能是普通 JSON
                        try {
                            const text = response.responseText || '';
                            // 先尝试解析为 SSE 格式
                            if (text.includes('data: ')) {
                                const content = this._parseSSE
                                    ? this._parseSSE(text)
                                    : (function() {
                                        let c = '';
                                        for (const line of text.split('\n')) {
                                            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                                                try { c += JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || ''; } catch(e) {}
                                            }
                                        }
                                        return c;
                                    })();
                                if (content) {
                                    if (onChunk) onChunk(content, content);
                                    done(content);
                                    return;
                                }
                            }
                            // 回退：尝试解析为普通 JSON
                            const data = JSON.parse(text);
                            const content = data.choices?.[0]?.message?.content?.trim();
                            done(content || fullContent || '');
                        } catch (e) {
                            // 如果已有累积内容，使用它
                            if (fullContent) {
                                done(fullContent);
                            } else {
                                fail(new Error(`解析响应失败: ${e.message}`));
                            }
                        }
                    },
                    onprogress: function(response) {
                        try {
                            const text = response.responseText || '';
                            const lines = text.split('\n');
                            // 只处理新内容（从上次位置开始）
                            for (const line of lines) {
                                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                                    try {
                                        const data = JSON.parse(line.slice(6));
                                        const delta = data.choices?.[0]?.delta?.content;
                                        if (delta && !fullContent.endsWith(delta)) {
                                            fullContent += delta;
                                            if (onChunk) onChunk(delta, fullContent);
                                        }
                                    } catch (e) {}
                                }
                            }
                        } catch (e) {}
                    },
                    onerror: function(error) {
                        const detail = error.error || error.statusText || error.responseText || '请检查网络连接和API地址是否正确';
                        fail(new Error(`网络请求失败: ${detail}`));
                    },
                    ontimeout: function() {
                        fail(new Error('API 请求超时'));
                    },
                    timeout: 60000,
                });
                Controller._currentXHR = xhr;
            });
        },
    };

    // ==================== 答案填写器 ====================
    const AnswerFiller = {
        // 解析 AI 返回的答案
        parseAnswer(rawAnswer, question) {
            let answer = rawAnswer.trim()
                .replace(/^[：:]\s*/, '')
                .replace(/\s*[。.]\s*$/, '')
                .replace(/^["']|["']$/g, '');

            const type = question.answerType;

            switch (type) {
                case 0: // 单选题
                    return this._parseChoiceAnswer(answer, question, false);
                case 1: // 多选题
                    return this._parseChoiceAnswer(answer, question, true);
                case 2: // 判断题
                    return this._parseJudgeAnswer(answer);
                case 3: // 填空题
                    return this._parseBlankAnswer(answer, question);
                case 4: // 简答题
                case 5: // 论述题
                case 6: // 计算题
                case 7: // 问答题
                    return { type: 'text', content: answer };
                default:
                    return { type: 'text', content: answer };
            }
        },

        _parseChoiceAnswer(answer, question, isMulti) {
            // 提取选项字母
            let letters = [];

            if (isMulti) {
                // 多选题：提取所有字母
                const match = answer.match(/[A-Za-z]/g);
                if (match) {
                    letters = [...new Set(match.map(l => l.toUpperCase()))].sort();
                }
            } else {
                // 单选题：取第一个字母
                const match = answer.match(/[A-Za-z]/);
                if (match) {
                    letters = [match[0].toUpperCase()];
                }
            }

            // 如果没找到字母，尝试匹配选项内容
            if (letters.length === 0) {
                for (const opt of question.options) {
                    if (answer.includes(opt.text) || opt.text.includes(answer)) {
                        letters.push(opt.label.replace(/[^A-Z]/g, ''));
                    }
                }
            }

            return {
                type: isMulti ? 'multi' : 'single',
                letters: letters,
            };
        },

        _parseJudgeAnswer(answer) {
            const trueWords = ['正确', '是', '对', '√', 't', 'true', '对的', '正确答案'];
            const falseWords = ['错误', '否', '错', '×', 'f', 'false', '错的', '错误答案'];

            const lower = answer.toLowerCase();
            const isTrue = trueWords.some(w => lower.includes(w));
            const isFalse = falseWords.some(w => lower.includes(w));

            return {
                type: 'judge',
                isTrue: isTrue && !isFalse,
                // 默认对
                value: isFalse ? false : true,
            };
        },

        _parseBlankAnswer(answer, question) {
            // 尝试用 ||| 分隔
            let parts = answer.split('|||').map(s => s.trim()).filter(Boolean);

            // 如果只有一个空但有多个答案，尝试其他分隔符
            if (question.blanks.length > 1 && parts.length === 1) {
                parts = answer.split(/[;；\n]/).map(s => s.trim()).filter(Boolean);
            }

            return {
                type: 'blank',
                parts: parts,
            };
        },

        // 填写答案
        async fill(question, parsedAnswer) {
            const type = question.answerType;
            Logger.info(`填写答案: 类型=${type}, 答案类型=${parsedAnswer.type}`);

            switch (type) {
                case 0: // 单选题
                case 1: // 多选题
                case 2: // 判断题
                    await this._fillChoice(question, parsedAnswer);
                    break;
                case 3: // 填空题
                    await this._fillBlank(question, parsedAnswer);
                    break;
                case 4: // 简答题
                case 5: // 论述题
                case 6: // 计算题
                case 7: // 问答题
                    await this._fillText(question, parsedAnswer);
                    break;
                default:
                    // 未知题型: 尝试智能填写
                    Logger.warn(`未知题型(${type})，尝试智能填写...`);
                    if (parsedAnswer.type === 'blank' && parsedAnswer.parts) {
                        await this._fillBlank(question, parsedAnswer);
                    } else if (parsedAnswer.type === 'text' && parsedAnswer.content) {
                        await this._fillText(question, parsedAnswer);
                    } else {
                        // 最后尝试: 先当填空填，填不了再当文本填
                        const rawAnswer = parsedAnswer.parts ? parsedAnswer.parts.join('') :
                                         parsedAnswer.content || parsedAnswer.letters?.join('') || '';
                        if (rawAnswer) {
                            await this._fillBlank(question, { type: 'blank', parts: [rawAnswer] });
                        }
                    }
                    break;
            }
        },

        async _fillChoice(question, parsedAnswer) {
            const { type, letters, isTrue, value } = parsedAnswer;

            if (type === 'judge') {
                // 判断题：第一个选项是"对"，第二个是"错"
                const targetIndex = value ? 0 : 1;
                if (question.options[targetIndex]) {
                    this._clickOption(question.options[targetIndex].element);
                }
            } else {
                // 选择题
                for (const letter of letters) {
                    const opt = question.options.find(o =>
                        o.label.toUpperCase().startsWith(letter.toUpperCase())
                    );
                    if (opt) {
                        this._clickOption(opt.element);
                        await sleep(300);
                    }
                }
            }
        },

        _clickOption(element) {
            // 模拟真实点击 - 只触发点击，不手动修改样式
            try {
                element.click();
            } catch (e) {
                try {
                    const evt = new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                    });
                    element.dispatchEvent(evt);
                } catch (e2) {
                    element.dispatchEvent(new Event('click', { bubbles: true }));
                }
            }
        },

        async _fillBlank(question, parsedAnswer) {
            const { parts } = parsedAnswer;
            Logger.info(`填空题答案: ${JSON.stringify(parts)}, 空白数: ${question.blanks.length}`);

            // ===== 预填写诊断 =====
            // Logger.info(`[诊断] 题目元素: <${question.element.tagName}> class="${question.element.className}"`);
            // Logger.info(`[诊断] 题目内 .Answer=${question.element.querySelectorAll('.Answer').length}, textarea=${question.element.querySelectorAll('textarea').length}, iframe=${question.element.querySelectorAll('iframe').length}`);
            // const nextSib = question.element.nextElementSibling;
            // if (nextSib) Logger.info(`[诊断] 下一个兄弟: <${nextSib.tagName}> class="${nextSib.className}"`);
            // const timuParent = question.element.closest('.TiMu') || question.element.parentElement;
            // if (timuParent) Logger.info(`[诊断] 父元素内 .Answer=${timuParent.querySelectorAll('.Answer').length}, textarea=${timuParent.querySelectorAll('textarea').length}, iframe=${timuParent.querySelectorAll('iframe').length}`);

            if (!parts || parts.length === 0) {
                Logger.warn('没有可填写的答案');
                return;
            }

            // ===== 查找 .Answer 容器 =====
            // 学习通有两种布局：
            //   布局A: .Answer 是 .questionLi 的子元素
            //   布局B: .Answer 是 .questionLi 的兄弟元素（与 .questionLi 并列）
            let answerContainers = Array.from(question.element.querySelectorAll('.Answer'));

            // 子元素没找到，查找兄弟节点
            if (answerContainers.length === 0) {
                Logger.info('.Answer 不在 questionLi 内部，查找兄弟节点...');
                let sibling = question.element.nextElementSibling;
                while (sibling) {
                    // 遇到下一个题目就停止
                    if (sibling.classList.contains('questionLi') ||
                        sibling.querySelector('.questionLi') ||
                        sibling.classList.contains('TiMu')) {
                        break;
                    }
                    if (sibling.classList.contains('Answer')) {
                        answerContainers.push(sibling);
                    }
                    // 也查找兄弟内部的 .Answer
                    const nested = sibling.querySelectorAll('.Answer');
                    nested.forEach(a => answerContainers.push(a));
                    sibling = sibling.nextElementSibling;
                }
                if (answerContainers.length > 0) {
                    Logger.info(`在兄弟节点中找到 ${answerContainers.length} 个 .Answer 容器`);
                }
            }

            // 再试：从父元素 (.TiMu 或直接父级) 查找所有 .Answer
            if (answerContainers.length === 0) {
                const parent = question.element.closest('.TiMu') || question.element.parentElement;
                if (parent) {
                    answerContainers = Array.from(parent.querySelectorAll('.Answer'));
                    if (answerContainers.length > 0) {
                        Logger.info(`在父容器中找到 ${answerContainers.length} 个 .Answer 容器`);
                    }
                }
            }

            if (answerContainers.length > 0) {
                Logger.info(`共找到 ${answerContainers.length} 个 .Answer 容器，逐个填写...`);
                for (let i = 0; i < answerContainers.length; i++) {
                    const answer = parts[i] || parts[0] || '';
                    if (!answer) {
                        Logger.warn(`第 ${i + 1} 个空没有对应答案`);
                        continue;
                    }
                    Logger.info(`填写第 ${i + 1} 个空: "${answer.substring(0, 50)}"`);
                    try {
                        await this._fillSingleBlank(answerContainers[i], answer, question);
                    } catch (e) {
                        Logger.error(`填写第 ${i + 1} 个空失败: ${e.message}`);
                    }
                    await sleep(500);
                }
                this._notifyPlatform(question);
                return;
            }

            // ===== 备选：收集所有可能的填空元素 =====
            Logger.info('未找到 .Answer 容器，尝试收集填空元素...');
            let blankElements = this._collectBlankElements(question);

            if (blankElements.length === 0) {
                Logger.info('未立即找到填空元素，等待 2 秒后重试...');
                await sleep(2000);
                blankElements = this._collectBlankElements(question);
            }

            if (blankElements.length === 0) {
                Logger.error('未找到任何填空输入元素');
                this._logDebugInfo(question);
                return;
            }

            Logger.info(`找到 ${blankElements.length} 个填空元素，答案 ${parts.length} 个，开始填写...`);

            for (let i = 0; i < Math.max(blankElements.length, parts.length); i++) {
                const answer = parts[i] || parts[0] || '';
                const el = blankElements[i];
                if (!el) {
                    Logger.warn(`第 ${i + 1} 个空没有对应元素`);
                    continue;
                }
                if (!answer) {
                    Logger.warn(`第 ${i + 1} 个空没有对应答案`);
                    continue;
                }
                Logger.info(`填写第 ${i + 1} 个空: "${answer.substring(0, 50)}" -> <${el.tagName.toLowerCase()}> id=${el.id || '无'}`);
                try {
                    await this._fillSingleBlank(el.closest('.Answer') || el.parentElement, answer, question, el);
                } catch (e) {
                    Logger.error(`填写第 ${i + 1} 个空失败: ${e.message}`);
                }
                await sleep(500);
            }

            this._notifyPlatform(question);
        },

        // 获取正确 window 上下文的 UE 对象
        // 关键：Tampermonkey 沙箱中，window/ownerDocument.defaultView 都是代理，
        //        无法访问页面全局变量，必须用 unsafeWindow
        _getUE(container) {
            let foundUE = null;
            // 1. 题目在 iframe 内：通过 iframe.contentWindow 获取 UE
            try {
                const ownerDoc = container?.ownerDocument;
                if (ownerDoc && ownerDoc !== document) {
                    // 找到包含此文档的 iframe
                    const allIframes = document.querySelectorAll('iframe');
                    for (const f of allIframes) {
                        try {
                            if (f.contentDocument === ownerDoc && f.contentWindow && f.contentWindow.UE) {
                                foundUE = f.contentWindow.UE;
                                break;
                            }
                        } catch (e) {}
                    }
                }
            } catch (e) {}

            // 2. unsafeWindow（穿透 Tampermonkey 沙箱访问主页面）
            if (!foundUE) {
                try {
                    if (typeof unsafeWindow !== 'undefined' && unsafeWindow.UE) {
                        foundUE = unsafeWindow.UE;
                    }
                } catch (e) {}
            }

            // 3. 普通回退
            if (!foundUE) {
                try {
                    if (typeof UE !== 'undefined') foundUE = UE;
                } catch (e) {}
            }

            // 【关键防御】自动给找到的 UEditor 打猴子补丁，防止其触发学习通的全局崩溃
            if (foundUE && foundUE.Editor && foundUE.Editor.prototype && !foundUE._patchedByAI) {
                try {
                    const origHasContents = foundUE.Editor.prototype.hasContents;
                    foundUE.Editor.prototype.hasContents = function(tags) {
                        try { return origHasContents.call(this, tags); } 
                        catch (e) { return true; } // 哪怕崩溃也视为有内容
                    };
                    
                    const origGetContent = foundUE.Editor.prototype.getContent;
                    foundUE.Editor.prototype.getContent = function() {
                        try { return origGetContent.apply(this, arguments); }
                        catch (e) { return this.body ? this.body.innerHTML : ''; } // 崩溃时直接返回底层 HTML
                    };
                    
                    foundUE._patchedByAI = true;
                    // Logger.info('已对当前 UE 实例注入防崩溃补丁');
                } catch (e) {}
            }

            return foundUE;
        },

        // 填写单个空白 - 在指定容器内找到最佳的可编辑元素
        async _fillSingleBlank(container, text, question, fallbackElement) {
            if (!container) {
                if (fallbackElement) {
                    this._doSmartFill(fallbackElement, text);
                    return;
                }
                Logger.error('容器和备选元素均为空');
                return;
            }

            const tag = container.tagName?.toLowerCase() || '';
            // Logger.info(`_fillSingleBlank: container=<${tag}> class="${(container.className || '').toString().substring(0, 50)}"`);

            // 策略0: 通过 UEditor API（最可靠，同时设置 iframe 和 textarea）
            const textarea = container.querySelector('textarea');
            if (textarea && textarea.id) {
                const filled = await this._fillViaUEditor(textarea, text, container);
                if (filled) {
                    this._syncToTextarea(container, text);
                    this._syncToHiddenAnswer(question, text);
                    return;
                }
            }

            // 策略1: 查找 UEditor iframe 并写入其 body
            const iframes = container.querySelectorAll('iframe');
            // Logger.info(`  容器内 iframe 数量: ${iframes.length}`);
            for (const iframe of iframes) {
                try {
                    const iDoc = iframe.contentDocument;
                    if (!iDoc) {
                        Logger.warn(`  iframe.contentDocument 为 null`);
                        continue;
                    }
                    const body = iDoc.body;
                    if (body && (body.getAttribute('contenteditable') === 'true' || body.isContentEditable)) {
                        this._doFillContentEditable(body, text, iframe.contentWindow, iDoc);
                        this._syncToTextarea(container, text);
                        this._syncToHiddenAnswer(question, text);
                        Logger.success(`✓ 通过 UEditor iframe body 设置内容`);
                        return;
                    }
                } catch (e) {
                    Logger.warn(`  iframe 访问失败: ${e.message}`);
                }
            }

            // 策略2: UEditor 可能还没初始化，等待一下重试
            if (iframes.length === 0 && textarea) {
                // Logger.info('  未找到 iframe，等待 UEditor 初始化...');
                await sleep(2000);

                // 重试查找 iframe
                const iframesRetry = container.querySelectorAll('iframe');
                // Logger.info(`  重试: iframe 数量=${iframesRetry.length}`);
                for (const iframe of iframesRetry) {
                    try {
                        const iDoc = iframe.contentDocument;
                        if (!iDoc) continue;
                        const body = iDoc.body;
                        if (body && (body.getAttribute('contenteditable') === 'true' || body.isContentEditable)) {
                            this._doFillContentEditable(body, text, iframe.contentWindow, iDoc);
                            this._syncToTextarea(container, text);
                            this._syncToHiddenAnswer(question, text);
                            Logger.success(`✓ 通过 UEditor iframe body 设置内容（重试成功）`);
                            return;
                        }
                    } catch (e) {}
                }

                // 重试 UEditor API
                if (textarea.id) {
                    const filled = await this._fillViaUEditor(textarea, text, container);
                    if (filled) {
                        this._syncToTextarea(container, text);
                        this._syncToHiddenAnswer(question, text);
                        return;
                    }
                }
            }

            // 策略3: 可见的 contenteditable 元素
            const editables = container.querySelectorAll('[contenteditable="true"]');
            for (const editable of editables) {
                if (editable.offsetParent !== null || editable.offsetWidth > 0) {
                    this._doFillContentEditable(editable, text);
                    this._syncToTextarea(container, text);
                    this._syncToHiddenAnswer(question, text);
                    Logger.success(`✓ 通过 contenteditable 设置内容`);
                    return;
                }
            }

            // 策略4: .edui-body-container
            const eduiBody = container.querySelector('.edui-body-container');
            if (eduiBody) {
                this._doFillContentEditable(eduiBody, text);
                this._syncToTextarea(container, text);
                this._syncToHiddenAnswer(question, text);
                Logger.success(`✓ 通过 edui-body-container 设置内容`);
                return;
            }

            // 策略5: 可见的 input[type="text"]
            const visibleInput = container.querySelector('input[type="text"]');
            if (visibleInput && visibleInput.offsetParent !== null) {
                this._doSetInputValue(visibleInput, text);
                this._syncToHiddenAnswer(question, text);
                Logger.success(`✓ 通过 input[type="text"] 设置内容`);
                return;
            }

            // 策略6: 直接设置 textarea
            if (textarea) {
                this._doSetInputValue(textarea, text);
                this._syncToHiddenAnswer(question, text);
                Logger.success(`✓ 通过 textarea 直接设置 (id=${textarea.id || '无'})`);
                return;
            }

            // 策略7: 使用备选元素
            if (fallbackElement) {
                this._doSmartFill(fallbackElement, text);
                this._syncToHiddenAnswer(question, text);
                return;
            }

            Logger.error('容器内未找到任何可编辑元素');
            // Logger.info(`容器 HTML: ${container.innerHTML.substring(0, 500)}`);
            // 全局最后尝试: 直接查找容器内所有 input/textarea/contenteditable
            const anyEditable = container.querySelector('input, textarea, [contenteditable]');
            if (anyEditable) {
                Logger.info(`  兜底: 找到 <${anyEditable.tagName.toLowerCase()}> id=${anyEditable.id || '无'}`);
                this._doSmartFill(anyEditable, text);
                this._syncToHiddenAnswer(question, text);
            }
        },

        // 通过 UEditor API 填写（从正确的 window 上下文获取 UE）
        _fillViaUEditor(textarea, text, container) {
            const ue = this._getUE(container || textarea);
            if (!ue || !textarea.id) {
                // Logger.info(`  UEditor API 不可用 (UE=${ue ? '有' : '无'}, textarea.id=${textarea.id || '无'})`);
                return false;
            }

            // Logger.info(`  尝试 UEditor API, textarea.id='${textarea.id}'`);

            // 方式A: UE.getEditor(id)
            try {
                const editor = ue.getEditor(textarea.id);
                if (editor) {
                    if (editor.isReady) {
                        editor.setContent(text);
                        Logger.success(`✓ UE.getEditor('${textarea.id}').setContent()`);
                        return true;
                    } else {
                        editor.ready(() => {
                            editor.setContent(text);
                        });
                        Logger.success(`✓ UE editor.ready() 延迟设置`);
                        return true;
                    }
                }
            } catch (e) {
                Logger.info(`  UE.getEditor 失败: ${e.message}`);
            }

            // 方式B: 遍历 UE.instants
            try {
                if (ue.instants) {
                    for (const key in ue.instants) {
                        const inst = ue.instants[key];
                        if (!inst) continue;
                        // 匹配: textarea 元素相同、或 key 包含 textarea id
                        if (inst.textarea === textarea ||
                            (inst.key && inst.key === textarea.id) ||
                            key.includes(textarea.id)) {
                            inst.setContent(text);
                            Logger.success(`✓ UE.instants[${key}].setContent()`);
                            return true;
                        }
                    }
                }
            } catch (e) {
                Logger.info(`  UE.instants 遍历失败: ${e.message}`);
            }

            Logger.info(`  UEditor API 未能匹配到编辑器实例`);
            return false;
        },

        // 同步内容到容器内的隐藏 textarea
        _syncToTextarea(container, text) {
            try {
                const textareas = container.querySelectorAll('textarea');
                textareas.forEach(ta => {
                    try {
                        const proto = window.HTMLTextAreaElement.prototype;
                        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
                        nativeSetter.call(ta, text);
                    } catch (e) {
                        ta.value = text;
                    }
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                    ta.dispatchEvent(new Event('change', { bubbles: true }));
                });
            } catch (e) {}
        },

        // 同步到隐藏的 answer 输入框
        _syncToHiddenAnswer(question, text) {
            if (!question) return;
            try {
                // 设置 hiddenAnswer 元素
                if (question.hiddenAnswer) {
                    question.hiddenAnswer.value = text;
                    question.hiddenAnswer.dispatchEvent(new Event('change', { bubbles: true }));
                }
                // 尝试用 questionId 查找
                if (question.questionId) {
                    const ownerDoc = question.element.ownerDocument || document;
                    const hidden = ownerDoc.querySelector(`#answer${question.questionId}`);
                    if (hidden) {
                        hidden.value = text;
                        hidden.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            } catch (e) {}
        },

        // 智能判断元素类型并填写
        _doSmartFill(element, text) {
            const tag = element.tagName.toLowerCase();
            const isContentEditable = element.getAttribute('contenteditable') === 'true' || element.isContentEditable;
            if (isContentEditable) {
                this._doFillContentEditable(element, text);
            } else if (tag === 'textarea' || tag === 'input') {
                this._doSetInputValue(element, text);
            } else {
                element.textContent = text;
                element.dispatchEvent(new Event('input', { bubbles: true }));
            }
        },

        // 收集填空元素（不含 .Answer 容器策略）
        _collectBlankElements(question) {
            let blankElements = [];

            // 从 blanks 获取
            for (const b of question.blanks) {
                if (b.element && b.element.isConnected !== false) {
                    blankElements.push(b.element);
                }
            }
            if (blankElements.length > 0) return blankElements;

            // 从题目元素内用选择器查找
            const selectors = [
                '.blank_box input[type="text"]', '.tkInput', 'input.cloze',
                '[class*="fillblank"] input', '[class*="tiankong"] input',
                '.Answer input[type="text"]', '.Answer textarea',
                'textarea[name^="answerEditor"]',
                '.edui-body-container', '[contenteditable="true"]',
                'textarea', 'input[type="text"]'
            ];
            for (const sel of selectors) {
                const found = question.element.querySelectorAll(sel);
                if (found.length > 0) {
                    blankElements = Array.from(found);
                    Logger.info(`通过 ${sel} 在题目内找到 ${found.length} 个填空元素`);
                    break;
                }
            }
            if (blankElements.length > 0) return blankElements;

            // 从兄弟和父元素查找
            const parent = question.element.closest('.TiMu') || question.element.parentElement;
            if (parent) {
                const all = parent.querySelectorAll(
                    '.Answer textarea, .Answer input[type="text"], ' +
                    '[contenteditable="true"], .edui-body-container'
                );
                blankElements = Array.from(all).filter(el => !el.closest('#ai-answer-panel'));
            }
            return blankElements;
        },

        // 输出调试信息
        _logDebugInfo(question) {
            Logger.info(`题目元素标签: ${question.element.tagName}, 类名: ${question.element.className}`);
            Logger.info(`题目 HTML 片段: ${question.element.innerHTML.substring(0, 500)}`);
            // 打印兄弟节点信息
            let sib = question.element.nextElementSibling;
            let sibIdx = 0;
            while (sib && sibIdx < 5) {
                Logger.info(`兄弟[${sibIdx}]: <${sib.tagName.toLowerCase()}> class="${(sib.className || '').toString().substring(0, 50)}"`);
                sibIdx++;
                sib = sib.nextElementSibling;
            }
            // 打印父容器信息
            const parent = question.element.closest('.TiMu') || question.element.parentElement;
            if (parent) {
                const answers = parent.querySelectorAll('.Answer');
                const textareas = parent.querySelectorAll('textarea');
                const iframes = parent.querySelectorAll('iframe');
                Logger.info(`父容器: .Answer=${answers.length}, textarea=${textareas.length}, iframe=${iframes.length}`);
            }
            // 打印题目内元素
            const allInputs = question.element.querySelectorAll('input, textarea, [contenteditable], iframe');
            if (allInputs.length > 0) {
                Logger.info(`题目内共有 ${allInputs.length} 个输入/iframe元素:`);
                allInputs.forEach((inp, i) => {
                    const tag = inp.tagName.toLowerCase();
                    const cls = (inp.className || '').toString().substring(0, 40);
                    const ce = inp.getAttribute('contenteditable') || '';
                    const vis = inp.offsetParent !== null ? '可见' : '隐藏';
                    const id = inp.id || '无';
                    Logger.info(`  [${i}] <${tag}> id="${id}" class="${cls}" contenteditable="${ce}" ${vis}`);
                });
            } else {
                Logger.info('题目内没有任何 input/textarea/contenteditable/iframe 元素');
            }
        },

        // 通知平台
        _notifyPlatform(question) {
            if (!question) return;
            try {
                // loadEditorAnswerd 在页面的 window 上，Tampermonkey 沙箱中必须用 unsafeWindow
                const qId = question.questionId;
                if (!qId) return;

                // 尝试 iframe 的 contentWindow
                const ownerDoc = question.element.ownerDocument;
                if (ownerDoc && ownerDoc !== document) {
                    const allIframes = document.querySelectorAll('iframe');
                    for (const f of allIframes) {
                        try {
                            if (f.contentDocument === ownerDoc && f.contentWindow) {
                                if (typeof f.contentWindow.loadEditorAnswerd === 'function') {
                                    f.contentWindow.loadEditorAnswerd(qId, 3);
                                    Logger.info(`✓ 通过 iframe.contentWindow 调用 loadEditorAnswerd(${qId}, 3)`);
                                    return;
                                }
                            }
                        } catch (e) {}
                    }
                }

                // unsafeWindow
                if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.loadEditorAnswerd === 'function') {
                    unsafeWindow.loadEditorAnswerd(qId, 3);
                    Logger.info(`✓ 通过 unsafeWindow 调用 loadEditorAnswerd(${qId}, 3)`);
                }
            } catch (e) {}
            try {
                question.element.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (e) {}
        },

        async _fillText(question, parsedAnswer) {
            const { content } = parsedAnswer;
            Logger.info(`文本题答案: ${content.substring(0, 50)}...`);

            // ===== 预填写诊断 =====
            // Logger.info(`[诊断] 文本题题目元素: <${question.element.tagName}> class="${question.element.className}"`);
            // Logger.info(`[诊断] 题目内 .Answer=${question.element.querySelectorAll('.Answer').length}, textarea=${question.element.querySelectorAll('textarea').length}, iframe=${question.element.querySelectorAll('iframe').length}`);

            // 优先查找 .Answer 容器（与 _fillBlank 相同逻辑：子元素 → 兄弟 → 父级）
            let answerContainer = question.element.querySelector('.Answer');

            if (!answerContainer) {
                // 查找兄弟节点
                let sibling = question.element.nextElementSibling;
                while (sibling) {
                    if (sibling.classList.contains('questionLi') || sibling.classList.contains('TiMu')) break;
                    if (sibling.classList.contains('Answer')) {
                        answerContainer = sibling;
                        break;
                    }
                    const nested = sibling.querySelector('.Answer');
                    if (nested) { answerContainer = nested; break; }
                    sibling = sibling.nextElementSibling;
                }
            }

            if (!answerContainer) {
                const parent = question.element.closest('.TiMu') || question.element.parentElement;
                if (parent) answerContainer = parent.querySelector('.Answer');
            }

            if (answerContainer) {
                Logger.info('文本题: 通过 .Answer 容器填写');
                await this._fillSingleBlank(answerContainer, content, question);
                this._notifyPlatform(question);
                return;
            }

            // 备选：直接查找输入元素
            let targetElement = null;

            if (question.blanks.length > 0) {
                targetElement = question.blanks[0].element;
            }

            if (!targetElement) {
                const selectors = [
                    'textarea[name^="answerEditor"]',
                    '.edui-body-container',
                    '[contenteditable="true"]',
                    'textarea',
                    'input[type="text"]'
                ];
                for (const sel of selectors) {
                    targetElement = question.element.querySelector(sel);
                    if (targetElement) {
                        Logger.info(`通过 ${sel} 找到输入元素`);
                        break;
                    }
                }
            }

            if (targetElement) {
                this._fillTextarea(targetElement, content);
            } else {
                Logger.error('未找到文本输入元素');
            }

            this._notifyPlatform(question);
        },

        _fillTextarea(element, text) {
            // 此方法现在仅用于简答题等非填空题，填空题走 _fillSingleBlank
            try {
                const container = element.closest('.Answer') || element.closest('.answer_content') || element.parentElement;
                if (container) {
                    this._fillSingleBlank(container, text, null, element);
                } else {
                    this._doSmartFill(element, text);
                }
            } catch (e) {
                Logger.error(`_fillTextarea 异常: ${e.message}`);
            }
        },

        // 辅助: 填写 contenteditable 元素
        // win/doc 参数用于 iframe 场景：传入 iframe.contentWindow / iframe.contentDocument
        _doFillContentEditable(element, text, win, doc) {
            const targetDoc = doc || (element.ownerDocument || document);
            try {
                element.focus();
            } catch (e) {}

            // 方法1: 直接设置 innerHTML（最可靠，兼容性最好）
            try {
                element.innerHTML = text;
                Logger.info('✓ 已通过 innerHTML 设置 contenteditable 内容');
            } catch (e) {
                // 方法2: textContent 兜底
                try {
                    element.textContent = text;
                    Logger.info('✓ 已通过 textContent 设置 contenteditable 内容');
                } catch (e2) {
                    Logger.warn(`contenteditable 设置失败: ${e2.message}`);
                    return;
                }
            }

            // 方法3: 同时尝试 execCommand（某些编辑器需要）
            try {
                const targetWin = win || (targetDoc.defaultView) || window;
                const sel = targetWin.getSelection();
                if (sel) {
                    const range = targetDoc.createRange();
                    range.selectNodeContents(element);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            } catch (e) {}

            // 触发事件
            try {
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                element.dispatchEvent(new Event('blur', { bubbles: true }));
            } catch (e) {}

            // 验证
            const actual = element.textContent || element.innerText || '';
            if (actual.trim()) {
                Logger.info(`  验证内容: "${actual.substring(0, 50)}"`);
            } else {
                Logger.warn(`  验证失败: 内容为空`);
            }
        },

        // 辅助: 设置 input/textarea 的值
        _doSetInputValue(element, text) {
            try {
                const tag = element.tagName.toLowerCase();
                // 先聚焦
                element.focus();
                element.dispatchEvent(new Event('focus', { bubbles: true }));

                // 使用原生 setter 绕过框架拦截
                try {
                    const proto = tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
                    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
                    nativeSetter.call(element, text);
                } catch (e) {
                    element.value = text;
                }

                // 触发事件序列
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
                element.dispatchEvent(new Event('blur', { bubbles: true }));
                try { element.dispatchEvent(new CustomEvent('valuechange', { bubbles: true })); } catch (e) {}

                // 验证
                const actual = element.value || '';
                Logger.info(`✓ 已设置 <${tag}> 值 (验证: "${actual.substring(0, 30)}")`);

                // 同时查找并更新关联的 contenteditable 或可见输入
                const parent = element.closest('.Answer') || element.closest('.answer_content') || element.parentElement;
                if (parent) {
                    const editable = parent.querySelector('[contenteditable="true"]');
                    if (editable && editable.offsetParent !== null) {
                        this._doFillContentEditable(editable, text);
                    }
                }
            } catch (e) {
                Logger.warn(`input/textarea 设置失败: ${e.message}`);
            }
        }
    };

    // ==================== 主控制器 ====================
    const Controller = {
        _running: false,
        _abort: false,
        _progress: { current: 0, total: 0 },
        _currentXHR: null,

        // 可中断的 sleep
        _sleep(ms) {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, ms);
                // 定期检查是否需要中断
                const check = setInterval(() => {
                    if (this._abort) {
                        clearTimeout(timer);
                        clearInterval(check);
                        reject(new Error('STOPPED'));
                    }
                }, 100);
                // 正常完成后清理检查器
                setTimeout(() => clearInterval(check), ms + 200);
            });
        },

        async start() {
            if (this._running) {
                Logger.warn('答题正在进行中...');
                return;
            }

            const apiKey = getApiKey();
            if (!apiKey) {
                Logger.error('请先配置 API Key！');
                return;
            }

            this._running = true;
            this._abort = false;
            this._updateUI();

            try {
                Logger.info('开始解析题目...');
                await FontDecryptor.init();

                const questions = DomParser.getQuestions();
                if (questions.length === 0) {
                    Logger.warn('未找到任何题目，请确认当前页面有题目');
                    return;
                }

                Logger.success(`共找到 ${questions.length} 道题目`);
                this._progress = { current: 0, total: questions.length };
                this._updateProgress();

                // 自动检测第一道未答题号
                const startInput = document.getElementById('ai-start-from');
                const userModified = startInput?.dataset.userModified === 'true';
                let firstUnanswered = 1;
                let alreadyAnswered = 0;
                for (let i = 0; i < questions.length; i++) {
                    if (this._isAnswered(questions[i])) {
                        alreadyAnswered++;
                    } else if (firstUnanswered === 1) {
                        firstUnanswered = i + 1;
                    }
                }
                // 如果全部已答完，默认第1题
                if (alreadyAnswered === questions.length) {
                    firstUnanswered = 1;
                }
                // 只在用户未手动修改时自动填充
                if (startInput && !userModified) {
                    startInput.value = firstUnanswered;
                }

                if (alreadyAnswered > 0) {
                    Logger.info(`检测到 ${alreadyAnswered} 道已答题目，将自动跳过`);
                }

                // 获取起始题号（优先用用户手动输入的值，否则用自动检测的）
                const userStart = parseInt(startInput?.value) || 1;
                const startFrom = Math.max(1, userStart);
                if (startFrom > 1) {
                    Logger.info(`从第 ${startFrom} 题开始（跳过前 ${startFrom - 1} 道已答题目）`);
                }

                let skipped = 0;
                for (let i = 0; i < questions.length; i++) {
                    // 每轮循环检查是否停止
                    if (this._abort) {
                        Logger.warn('答题已停止');
                        break;
                    }

                    const q = questions[i];
                    this._progress.current = i + 1;
                    this._updateProgress();

                    // 跳过起始题号之前的题目
                    if (i + 1 < startFrom) {
                        skipped++;
                        continue;
                    }

                    // 检查是否已答过（重新从 DOM 获取最新状态）
                    if (this._isAnswered(q)) {
                        Logger.info(`[${i + 1}/${questions.length}] 跳过已答题目: ${q.title.substring(0, 30)}...`);
                        skipped++;
                        continue;
                    }

                    Logger.info(`[${i + 1}/${questions.length}] ${q.typeName}(类型${q.answerType}): ${q.title.substring(0, 30)}...`);

                    try {
                        // 构建 prompt
                        const prompt = AIClient.buildPrompt(q);

                        // 调用 AI（流式失败自动回退非流式）
                        Logger.info(`正在请求 ${CONFIG.provider === 'deepseek' ? 'DeepSeek' : 'MiMo'} AI...`);
                        let answer;
                        if (CONFIG.stream) {
                            try {
                                answer = await AIClient.callStream(prompt, (chunk, full) => {});
                            } catch (streamErr) {
                                if (streamErr.message === 'STOPPED') throw streamErr;
                                Logger.warn(`流式请求失败，回退到非流式: ${streamErr.message}`);
                                answer = await AIClient.call(prompt);
                            }
                        } else {
                            answer = await AIClient.call(prompt);
                        }

                        // 再次检查是否停止
                        if (this._abort) {
                            Logger.warn('答题已停止');
                            break;
                        }

                        Logger.info(`AI 返回: ${answer.substring(0, 50)}`);

                        // 解析答案
                        const parsed = AnswerFiller.parseAnswer(answer, q);
                        Logger.info(`解析结果: ${JSON.stringify(parsed).substring(0, 80)}`);

                        // 填写答案
                        await AnswerFiller.fill(q, parsed);
                        Logger.success(`第 ${i + 1} 题已填写`);

                    } catch (e) {
                        if (e.message === 'STOPPED') {
                            Logger.warn('答题已停止');
                            break;
                        }
                        Logger.error(`第 ${i + 1} 题失败: ${e.message}`);
                    }

                    // 答题间隔（可中断）
                    if (i < questions.length - 1 && !this._abort) {
                        try {
                            await this._sleep(CONFIG.delay);
                        } catch (e) {
                            Logger.warn('答题已停止');
                            break;
                        }
                    }
                }

                if (!this._abort) {
                    if (skipped > 0) {
                        Logger.info(`跳过已答题目: ${skipped} 道`);
                    }
                    Logger.success('所有题目处理完成！');

                    // 重置手动修改标记，下次自动检测
                    if (startInput) {
                        delete startInput.dataset.userModified;
                    }

                    // 自动提交
                    if (CONFIG.autoSubmit) {
                        Logger.info('准备自动提交...');
                        await this._sleep(1000);
                        const submitBtn = DomParser.getSubmitButton();
                        if (submitBtn) {
                            submitBtn.click();
                            Logger.success('已点击提交');
                        }
                    }
                }

            } catch (e) {
                if (e.message !== 'STOPPED') {
                    Logger.error(`答题过程出错: ${e.message}`);
                }
            } finally {
                this._running = false;
                this._abort = false;
                this._currentXHR = null;
                this._updateUI();
            }
        },

        // 检查题目是否已答过
        _isAnswered(question) {
            const el = question.element;
            const type = question.answerType;

            // 如果 DOM 元素已失效，无法判断，视为未答
            if (!el || !el.isConnected) return false;

            // 选择题/判断题：检查是否有选项被选中
            if (type === 0 || type === 1 || type === 2) {
                // 检查原生 input 选中状态（最可靠）
                if (el.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked').length > 0) return true;

                // 检查选中态类名（覆盖学习通各种可能的命名）
                const selectedEls = el.querySelectorAll(
                    '.check_answer, .answerBg_on, .on, .active, ' +
                    '[class*="check_answer"], [class*="answerBg_on"]'
                );
                if (selectedEls.length > 0) return true;

                // 检查所有选项元素及子元素
                const options = el.querySelectorAll('.answerBg, .answer_li, li, [class*="option"]');
                for (const opt of options) {
                    const cls = opt.className || '';
                    if (/\bcheck_answer\b|\banswerBg_on\b|\bactive\b|\bon\b/.test(cls)) return true;

                    // 检查选项子元素是否有选中标记
                    if (opt.querySelector('.check, .checked, .icon-check, [class*="check_icon"], [class*="select"]')) return true;

                    // 检查隐藏 input
                    if (opt.querySelector('input:checked')) return true;

                    // 检查 aria 属性
                    if (opt.getAttribute('aria-checked') === 'true' || opt.getAttribute('aria-selected') === 'true') return true;
                    if (opt.getAttribute('data-checked') === 'true' || opt.getAttribute('data-selected') === 'true') return true;
                }

                // 检查题目级别的已答标记
                if (el.querySelector('[class*="answered"], [class*="done"], [class*="complete"]')) return true;
                if (el.getAttribute('data-answered') === 'true') return true;

                return false;
            }

            // 填空题/简答题等：检查是否有内容
            if (type >= 3) {
                // 直接使用我们在 _parseQuestion 中辛苦收集的 blanks 数组
                if (question.blanks && question.blanks.length > 0) {
                    let hasAnyText = false;
                    for (const b of question.blanks) {
                        const target = b.element;
                        if (!target) continue;
                        
                        let text = '';
                        if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
                            text = target.value || '';
                        } else if (target.tagName === 'IFRAME') {
                            try {
                                text = target.contentDocument?.body?.textContent || '';
                            } catch (e) {}
                        } else {
                            text = target.textContent || '';
                        }
                        
                        if (text.trim().length > 0) {
                            hasAnyText = true;
                            break;
                        }
                    }
                    if (hasAnyText) return true;
                } else {
                    // 兜底查找
                    const textareas = el.querySelectorAll('textarea');
                    for (const ta of textareas) {
                        if (ta.value && ta.value.trim().length > 0) return true;
                    }
                    const editables = el.querySelectorAll('[contenteditable="true"], .edui-body-container');
                    for (const ed of editables) {
                        if (ed.textContent && ed.textContent.trim().length > 0) return true;
                    }
                }
                
                // 绝对不要用 name*="answer" 匹配 hidden input，因为会匹配到 answertype="2" 导致全部被跳过！
            }

            return false;
        },

        stop() {
            this._abort = true;
            this._running = false;
            // 尝试中断当前网络请求
            if (this._currentXHR && this._currentXHR.abort) {
                try { this._currentXHR.abort(); } catch (e) {}
            }
            this._updateUI();
            Logger.warn('正在停止...');
        },

        _updateUI() {
            const btn = document.getElementById('ai-start-btn');
            const stopBtn = document.getElementById('ai-stop-btn');
            const statusEl = document.getElementById('ai-status');

            if (btn) {
                btn.disabled = this._running;
                btn.textContent = this._running ? '答题中...' : '开始答题';
            }
            if (stopBtn) {
                stopBtn.style.display = this._running ? 'block' : 'none';
            }
            if (statusEl) {
                statusEl.className = `status-badge ${this._running ? 'running' : 'ready'}`;
                statusEl.textContent = this._running ? '运行中' : '就绪';
            }
        },

        _updateProgress() {
            const bar = document.getElementById('ai-progress-fill');
            const text = document.getElementById('ai-progress-text');
            const startInput = document.getElementById('ai-start-from');
            if (bar) {
                const pct = this._progress.total > 0 ?
                    (this._progress.current / this._progress.total * 100) : 0;
                bar.style.width = pct + '%';
            }
            if (text) {
                text.textContent = `${this._progress.current} / ${this._progress.total}`;
            }
            // 实时更新起始题号为下一题，停止后可从下一题继续
            if (startInput && this._progress.current > 0) {
                startInput.value = Math.min(this._progress.current + 1, this._progress.total);
            }
        }
    };

    // ==================== UI 面板 ====================
    const Panel = {
        _el: null,
        _dragging: false,
        _offset: { x: 0, y: 0 },

        create() {
            const panel = document.createElement('div');
            panel.id = 'ai-answer-panel';
            panel.innerHTML = `
                <div class="panel-header" id="ai-panel-header">
                    <span>🤖 AI 答题助手</span>
                    <div class="panel-controls">
                        <button id="ai-collapse-btn" title="折叠">−</button>
                    </div>
                </div>
                <div class="panel-body">
                    <div class="tab-bar">
                        <button class="active" data-tab="control">控制</button>
                        <button data-tab="config">设置</button>
                        <button data-tab="log">日志</button>
                    </div>

                    <!-- 控制面板 -->
                    <div class="tab-content active" data-tab="control">
                        <div style="text-align:center;margin-bottom:12px;">
                            <span class="status-badge ready" id="ai-status">就绪</span>
                        </div>
                        <div class="config-group">
                            <label>从第几题开始（自动跳过已答题目）</label>
                            <input type="number" id="ai-start-from" value="1" min="1" placeholder="自动检测">
                        </div>
                        <button class="btn-primary" id="ai-start-btn">开始答题</button>
                        <button class="btn-secondary" id="ai-stop-btn" style="display:none;">停止</button>
                        <div class="progress-bar">
                            <div class="progress-bar-fill" id="ai-progress-fill"></div>
                        </div>
                        <div style="text-align:center;font-size:12px;color:#8e8b82;margin-top:4px;">
                            <span id="ai-progress-text">0 / 0</span>
                        </div>
                        <button class="btn-secondary" id="ai-parse-btn" style="margin-top:12px;">预览题目</button>
                        <button class="btn-secondary" id="ai-diag-btn" style="margin-top:6px;">🔍 诊断页面结构</button>
                    </div>

                    <!-- 设置面板 -->
                    <div class="tab-content" data-tab="config">
                        <div class="config-group">
                            <label>AI 提供商</label>
                            <select id="ai-provider">
                                <option value="deepseek">DeepSeek</option>
                                <option value="mimo">MiMo</option>
                            </select>
                        </div>
                        <div class="config-group">
                            <label>DeepSeek API Key</label>
                            <input type="password" id="ai-deepseek-key" placeholder="sk-...">
                        </div>
                        <div class="config-group">
                            <label>MiMo API Key</label>
                            <input type="password" id="ai-mimo-key" placeholder="sk-...">
                        </div>
                        <div class="config-group">
                            <label>自定义 Endpoint（可选）</label>
                            <input type="text" id="ai-custom-endpoint" placeholder="留空使用默认">
                        </div>
                        <div class="config-group">
                            <label>DeepSeek 模型</label>
                            <select id="ai-deepseek-model">
                                <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                                <option value="deepseek-v4-flash">deepseek-v4-flash</option>
                            </select>
                        </div>
                        <div class="config-group">
                            <label>MiMo 模型</label>
                            <select id="ai-mimo-model">
                                <option value="mimo-v2.5-pro">mimo-v2.5-pro</option>
                                <option value="mimo-v2.5">mimo-v2.5</option>
                            </select>
                        </div>
                        <div class="config-group" style="font-size:11px;color:#8e8b82;">
                            <label>API Key 获取：<a href="https://platform.deepseek.com/" target="_blank">DeepSeek 官网</a> · <a href="https://platform.xiaomimimo.com/console" target="_blank">MiMo 官网</a></label>
                        </div>
                        <div class="config-group">
                            <label>答题间隔 (ms)</label>
                            <input type="number" id="ai-delay" value="2000" min="500" max="10000">
                        </div>
                        <div class="config-group">
                            <label>
                                <input type="checkbox" id="ai-auto-submit"> 自动提交
                            </label>
                        </div>
                        <div class="config-group">
                            <label>
                                <input type="checkbox" id="ai-stream" checked> 流式输出
                            </label>
                        </div>
                        <button class="btn-primary" id="ai-save-config">保存设置</button>
                    </div>

                    <!-- 日志面板 -->
                    <div class="tab-content" data-tab="log">
                        <div class="log-area" id="ai-log-area"></div>
                        <button class="btn-secondary" id="ai-clear-log" style="margin-top:8px;">清空日志</button>
                    </div>
                </div>
            `;

            document.body.appendChild(panel);
            this._el = panel;
            this._initEvents();
            this._loadConfig();
        },

        _initEvents() {
            // Tab 切换
            this._el.querySelectorAll('.tab-bar button').forEach(btn => {
                btn.addEventListener('click', () => {
                    this._el.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
                    this._el.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    btn.classList.add('active');
                    this._el.querySelector(`.tab-content[data-tab="${btn.dataset.tab}"]`).classList.add('active');
                });
            });

            // 折叠/展开
            document.getElementById('ai-collapse-btn').addEventListener('click', () => {
                this._el.classList.toggle('collapsed');
            });
            this._el.querySelector('.panel-header').addEventListener('click', (e) => {
                if (this._el.classList.contains('collapsed')) {
                    this._el.classList.remove('collapsed');
                }
            });

            // 拖拽
            const header = document.getElementById('ai-panel-header');
            header.addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'BUTTON') return;
                this._dragging = true;
                const rect = this._el.getBoundingClientRect();
                this._offset.x = e.clientX - rect.left;
                this._offset.y = e.clientY - rect.top;
                e.preventDefault();
            });
            document.addEventListener('mousemove', (e) => {
                if (!this._dragging) return;
                this._el.style.left = (e.clientX - this._offset.x) + 'px';
                this._el.style.top = (e.clientY - this._offset.y) + 'px';
                this._el.style.right = 'auto';
            });
            document.addEventListener('mouseup', () => {
                this._dragging = false;
            });

            // 跟踪用户手动修改起始题号
            const startFromInput = document.getElementById('ai-start-from');
            if (startFromInput) {
                startFromInput.addEventListener('input', () => {
                    startFromInput.dataset.userModified = 'true';
                });
            }

            // 开始答题
            document.getElementById('ai-start-btn').addEventListener('click', () => {
                Controller.start();
            });

            // 停止
            document.getElementById('ai-stop-btn').addEventListener('click', () => {
                Controller.stop();
            });

            // 预览题目
            document.getElementById('ai-parse-btn').addEventListener('click', () => {
                Logger.info('正在解析题目...');
                const questions = DomParser.getQuestions();
                if (questions.length === 0) {
                    Logger.warn('未找到题目');
                } else {
                    Logger.success(`找到 ${questions.length} 道题目:`);
                    questions.forEach((q, i) => {
                        Logger.info(`${i + 1}. [${q.typeName}] ${q.title.substring(0, 50)}...`);
                    });
                }
                showToast('📋 请前往日志标签页查看结果');
            });

            // 诊断页面结构
            document.getElementById('ai-diag-btn').addEventListener('click', () => {
                Logger.clear();
                Logger.info('========== 开始诊断 ==========');

                // 1. 检查所有 iframe
                const iframes = document.querySelectorAll('iframe');
                Logger.info(`主页面 iframe 数量: ${iframes.length}`);

                // 2. 遍历所有文档
                const docs = DomParser._getDocs();
                Logger.info(`可访问文档数量: ${docs.length}`);

                docs.forEach((doc, docIdx) => {
                    const isMain = doc === document;
                    Logger.info(`--- 文档 ${docIdx} ${isMain ? '(主页面)' : '(iframe)'} ---`);

                    // 检查各种选择器
                    const checks = [
                        { name: '.questionLi', sel: '.questionLi' },
                        { name: '.TiMu', sel: '.TiMu' },
                        { name: '.tiMu', sel: '.tiMu' },
                        { name: '[typename]', sel: '[typename]' },
                        { name: 'input[name^="answertype"]', sel: 'input[name^="answertype"]' },
                        { name: '.mark_name', sel: '.mark_name' },
                        { name: 'h3.mark_name', sel: 'h3.mark_name' },
                        { name: '.answerBg', sel: '.answerBg' },
                        { name: '.Answer', sel: '.Answer' },
                        { name: '.answer_p', sel: '.answer_p' },
                        { name: '.num_option', sel: '.num_option' },
                        { name: 'textarea', sel: 'textarea' },
                        { name: '.type_tit', sel: '.type_tit' },
                        { name: 'h2.type_tit', sel: 'h2.type_tit' },
                    ];

                    checks.forEach(c => {
                        const count = doc.querySelectorAll(c.sel).length;
                        if (count > 0) {
                            Logger.success(`  ${c.name}: ${count} 个`);
                        }
                    });

                    // 如果找到 questionLi，显示前3个的详细信息
                    const qLi = doc.querySelectorAll('.questionLi');
                    if (qLi.length > 0) {
                        Logger.info(`  --- 前3个 .questionLi 详情 ---`);
                        for (let i = 0; i < Math.min(3, qLi.length); i++) {
                            const el = qLi[i];
                            const typename = el.getAttribute('typename') || '无';
                            const typeInput = el.querySelector('input[name^="answertype"]');
                            const typeVal = typeInput ? typeInput.value : '无';
                            const titleEl = el.querySelector('h3.mark_name') || el.querySelector('.mark_name') || el.querySelector('h3');
                            const title = titleEl ? titleEl.textContent.trim().substring(0, 40) : '无';
                            const opts = el.querySelectorAll('.answerBg').length;
                            const blanks = el.querySelectorAll(
                                '.Answer textarea, .Answer input[type="text"], ' +
                                '.blank_box input, .tkInput, input.cloze, .cloze input, ' +
                                '[class*="fillblank"] input, [class*="tiankong"] input, ' +
                                '.mark_name input, textarea, input[type="text"][name*="answer"], ' +
                                '[contenteditable="true"]'
                            ).length;
                            Logger.info(`  [${i}] typename="${typename}" answertype=${typeVal} 选项=${opts} 填空=${blanks}`);
                            Logger.info(`      标题: ${title}`);
                            Logger.info(`      类名: ${el.className}`);
                        }
                    }

                    // 如果没找到 questionLi，显示页面中有哪些包含题目的元素
                    if (qLi.length === 0) {
                        Logger.warn('  未找到 .questionLi，尝试其他方式...');
                        // 查找包含题目关键词的元素
                        const allElements = doc.querySelectorAll('*');
                        const found = new Set();
                        for (const el of allElements) {
                            const text = el.textContent || '';
                            const cls = el.className || '';
                            if ((cls.includes('question') || cls.includes('Question') ||
                                 cls.includes('timu') || cls.includes('TiMu') ||
                                 cls.includes('mark') || cls.includes('topic')) &&
                                el.children.length < 5) {
                                const tag = el.tagName.toLowerCase();
                                const info = `<${tag} class="${cls.substring(0, 50)}">`;
                                if (!found.has(info)) {
                                    found.add(info);
                                    Logger.info(`  找到: ${info} text="${text.substring(0, 30)}"`);
                                }
                            }
                        }
                        if (found.size === 0) {
                            Logger.error('  未找到任何题目相关元素');
                        }
                    }
                });

                Logger.info('========== 诊断完成 ==========');
                Logger.info('请将以上日志截图发给我分析');
                showToast('📋 请前往日志标签页查看诊断结果');
            });

            // 调试解析过程
            document.getElementById('ai-diag-btn').addEventListener('dblclick', () => {
                Logger.clear();
                Logger.info('========== 逐题解析测试 ==========');

                const doc = document;
                const qLi = doc.querySelectorAll('.questionLi');
                Logger.info(`共 ${qLi.length} 个 .questionLi 元素`);

                // 统计各题型数量
                const typeCounts = {};

                for (let i = 0; i < qLi.length; i++) {
                    const el = qLi[i];
                    const typename = el.getAttribute('typename') || '无';
                    typeCounts[typename] = (typeCounts[typename] || 0) + 1;
                }

                Logger.info('--- 题型统计 ---');
                for (const [type, count] of Object.entries(typeCounts)) {
                    Logger.info(`  ${type}: ${count} 道`);
                }

                // 测试解析函数 - 前10题
                Logger.info('--- 测试 _parseQuestion (前10题) ---');
                for (let i = 0; i < Math.min(10, qLi.length); i++) {
                    try {
                        const q = DomParser._parseQuestion(qLi[i], i);
                        if (q) {
                            Logger.success(`[${i}] ✓ type=${q.answerType}(${q.typeName}) opts=${q.options.length} blanks=${q.blanks.length} title="${q.title.substring(0, 25)}"`);
                        } else {
                            // 详细说明为什么返回 null
                            const el = qLi[i];
                            const titleEl = el.querySelector('h3.mark_name');
                            const titleRaw = titleEl ? titleEl.textContent.trim() : '无';
                            const titleClean = titleEl ? titleEl.textContent.trim()
                                .replace(/^\d+[.、．]\s*/, '')
                                .replace(/\(.*?\)\s*$/, '')
                                .replace(/（.*?）\s*$/, '') : '无';
                            Logger.warn(`[${i}] ✗ 返回null | 原始标题="${titleRaw.substring(0, 30)}" | 清理后="${titleClean.substring(0, 30)}"`);
                        }
                    } catch (e) {
                        Logger.error(`[${i}] ✗ 异常: ${e.message}`);
                    }
                }

                // 测试完整 getQuestions
                Logger.info('--- 测试 getQuestions ---');
                const allQ = DomParser.getQuestions();
                Logger.info(`getQuestions 返回 ${allQ.length} 道题`);

                // 统计返回的题型
                const returnTypeCounts = {};
                allQ.forEach(q => {
                    returnTypeCounts[q.typeName] = (returnTypeCounts[q.typeName] || 0) + 1;
                });
                Logger.info('返回题型统计:');
                for (const [type, count] of Object.entries(returnTypeCounts)) {
                    Logger.info(`  ${type}: ${count} 道`);
                }

                Logger.info('========== 测试完成 ==========');
                Logger.info('如果返回的题目数量与实际不符，请截图发给我');
                showToast('📋 请前往日志标签页查看测试结果');
            });

            // 保存设置
            document.getElementById('ai-save-config').addEventListener('click', () => {
                this._saveConfig();
                Logger.success('设置已保存');
                showToast('✅ 设置已保存');
            });

            // 清空日志
            document.getElementById('ai-clear-log').addEventListener('click', () => {
                Logger.clear();
            });
        },

        _loadConfig() {
            document.getElementById('ai-provider').value = CONFIG.provider;
            document.getElementById('ai-deepseek-key').value = CONFIG.deepseekKey;
            document.getElementById('ai-mimo-key').value = CONFIG.mimoKey;
            document.getElementById('ai-custom-endpoint').value = CONFIG.customEndpoint;
            document.getElementById('ai-deepseek-model').value = CONFIG.deepseekModel;
            document.getElementById('ai-mimo-model').value = CONFIG.mimoModel;
            document.getElementById('ai-delay').value = CONFIG.delay;
            document.getElementById('ai-auto-submit').checked = CONFIG.autoSubmit;
            document.getElementById('ai-stream').checked = CONFIG.stream;
        },

        _saveConfig() {
            CONFIG.provider = document.getElementById('ai-provider').value;
            CONFIG.deepseekKey = document.getElementById('ai-deepseek-key').value;
            CONFIG.mimoKey = document.getElementById('ai-mimo-key').value;
            CONFIG.customEndpoint = document.getElementById('ai-custom-endpoint').value;
            CONFIG.deepseekModel = document.getElementById('ai-deepseek-model').value;
            CONFIG.mimoModel = document.getElementById('ai-mimo-model').value;
            CONFIG.delay = parseInt(document.getElementById('ai-delay').value) || 2000;
            CONFIG.autoSubmit = document.getElementById('ai-auto-submit').checked;
            CONFIG.stream = document.getElementById('ai-stream').checked;

            GM_setValue('provider', CONFIG.provider);
            GM_setValue('deepseekKey', CONFIG.deepseekKey);
            GM_setValue('mimoKey', CONFIG.mimoKey);
            GM_setValue('customEndpoint', CONFIG.customEndpoint);
            GM_setValue('deepseekModel', CONFIG.deepseekModel);
            GM_setValue('mimoModel', CONFIG.mimoModel);
            GM_setValue('delay', CONFIG.delay);
            GM_setValue('autoSubmit', CONFIG.autoSubmit);
            GM_setValue('stream', CONFIG.stream);
        }
    };

    // ==================== 油猴菜单 ====================
    GM_registerMenuCommand('⚙️ 打开设置', () => {
        const panel = document.getElementById('ai-answer-panel');
        if (panel) {
            panel.classList.remove('collapsed');
            // 切换到设置 tab
            panel.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
            panel.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            panel.querySelector('.tab-bar button[data-tab="config"]').classList.add('active');
            panel.querySelector('.tab-content[data-tab="config"]').classList.add('active');
        }
    });

    GM_registerMenuCommand('🚀 开始答题', () => {
        Controller.start();
    });

    GM_registerMenuCommand('📋 预览题目', () => {
        const questions = DomParser.getQuestions();
        alert(`找到 ${questions.length} 道题目`);
    });

    // ==================== 初始化 ====================
    function init() {
        // 等待页面加载完成
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
            return;
        }

        // 创建面板
        Panel.create();
        Logger.init(document.getElementById('ai-log-area'));
        Logger.success('AI 答题助手已加载');

        // 检查是否在题目页面
        setTimeout(() => {
            const questions = DomParser.getQuestions();
            if (questions.length > 0) {
                Logger.info(`检测到 ${questions.length} 道题目，点击"开始答题"`);
            } else {
                Logger.info('当前页面未检测到题目，请导航到作业/考试页面');
            }
        }, 2000);
    }

    init();

})();
