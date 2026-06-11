// ==UserScript==
// @name         学习通AI自动答题
// @namespace    http://tampermonkey.net/
// @version      1.2.0
// @description  调用DeepSeek/MiMo AI自动完成学习通作业和考试题目
// @author       李荣宁
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
        provider: GM_getValue('provider', 'deepseek'),
        deepseekKey: GM_getValue('deepseekKey', ''),
        mimoKey: GM_getValue('mimoKey', ''),
        customEndpoint: GM_getValue('customEndpoint', ''),
        deepseekModel: GM_getValue('deepseekModel', 'deepseek-v4-pro'),
        mimoModel: GM_getValue('mimoModel', 'mimo-v2.5-pro'),
        delay: GM_getValue('delay', 2000),
        autoSubmit: GM_getValue('autoSubmit', false),
    };

    const ENDPOINTS = {
        deepseek: 'https://api.deepseek.com/chat/completions',
        mimo: 'https://api.xiaomimimo.com/v1/chat/completions',
    };

    // ==================== 全局防崩溃拦截器 ====================
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

    setInterval(() => {
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

    const QUESTION_TYPES = ['单选题', '多选题', '判断题', '填空题', '简答题', '论述题', '计算题', '问答题'];
    const matchType = (str) => ['单选', '多选', '判断', '填空', '简答', '论述', '计算', '问答'].findIndex(kw => str.includes(kw));

    // ==================== 样式 ====================
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
            transition: opacity 0.25s ease, transform 0.25s ease, width 0.3s ease, height 0.3s ease, border-radius 0.3s ease, background-color 0.3s ease, box-shadow 0.3s ease;
        }
        #ai-answer-panel.dragging {
            transition: none !important;
        }
        body.ai-dragging iframe {
            pointer-events: none !important;
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
            width: 100%;
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

    function showToast(msg, duration = 2000) {
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
            item.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
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
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const getApiKey = () => CONFIG.provider === 'deepseek' ? CONFIG.deepseekKey : CONFIG.mimoKey;
    const getEndpoint = () => CONFIG.customEndpoint || ENDPOINTS[CONFIG.provider] || ENDPOINTS.deepseek;
    const getModel = () => CONFIG.provider === 'deepseek' ? CONFIG.deepseekModel : CONFIG.mimoModel;

    // ==================== 字体解密 ====================
    const FontDecryptor = {
        _map: null,
        async init() {
            try {
                if (document.querySelector('.font-cxsecret')) {
                    Logger.info('检测到字体混淆，尝试解码...');
                    this._buildMap();
                }
            } catch (e) {
                Logger.warn('字体解密初始化失败: ' + e.message);
            }
        },
        _buildMap() {
            const cxElements = document.querySelectorAll('.font-cxsecret');
            this._map = new Map();
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
            if (this._map.size > 0) {
                Logger.success(`字体解密完成，映射 ${this._map.size} 个字符`);
            }
        },
        _getRenderedText(el) {
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
            return Array.from(text).map(char => this._map.get(char) || char).join('');
        }
    };

    // ==================== DOM 解析器 ====================
    const DomParser = {
        _getDocs() {
            const docs = [];
            const collect = (doc) => {
                if (!doc) return;
                docs.push(doc);
                doc.querySelectorAll('iframe').forEach(iframe => {
                    try {
                        if (iframe.contentDocument) collect(iframe.contentDocument);
                    } catch (e) {}
                });
            };
            collect(document);
            return docs;
        },

        _findQuestionDoc() {
            const docs = this._getDocs();
            let bestDoc = null;
            let maxCount = 0;
            for (const doc of docs) {
                try {
                    const count = doc.querySelectorAll('.questionLi, .TiMu, .tiMu, [typename]').length;
                    if (count > maxCount) {
                        maxCount = count;
                        bestDoc = doc;
                    }
                } catch (e) {}
            }
            if (bestDoc) return bestDoc;
            return docs.find(doc => {
                try {
                    return doc.querySelector('.questionLi, .TiMu, .tiMu, .mark_name, [typename], input[name^="answertype"]');
                } catch (e) {
                    return false;
                }
            }) || null;
        },

        getQuestions() {
            const doc = this._findQuestionDoc();
            if (!doc) {
                Logger.warn('未找到题目容器，请确认当前页面有题目');
                return [];
            }

            let questionElements = doc.querySelectorAll('.questionLi');
            if (questionElements.length === 0) {
                questionElements = doc.querySelectorAll('[typename]');
            }
            if (questionElements.length === 0) {
                const elements = Array.from(doc.querySelectorAll('input[name^="answertype"]'))
                    .map(input => input.closest('.questionLi, .TiMu') || input.parentElement)
                    .filter(Boolean);
                questionElements = [...new Set(elements)];
            }

            Logger.info(`找到 ${questionElements.length} 个题目元素，开始解析...`);
            const questions = [];
            questionElements.forEach((el, index) => {
                try {
                    const q = this._parseQuestion(el, index);
                    if (q) questions.push(q);
                } catch (e) {
                    Logger.error(`解析第 ${index + 1} 题失败: ${e.message}`);
                }
            });

            Logger.info(`解析完成，成功解析 ${questions.length}/${questionElements.length} 道题`);
            return questions;
        },

        _parseQuestion(el, index) {
            let answerType = -1;
            let typeName = el.getAttribute('typename') || '';

            const typeInput = el.querySelector('input[name^="answertype"]') || el.parentElement?.querySelector('input[name^="answertype"]');
            if (typeInput) answerType = parseInt(typeInput.value);

            if (answerType === -1 && typeName) {
                const idx = matchType(typeName);
                if (idx !== -1) answerType = idx;
            }

            if (answerType === -1) {
                const sectionTitle = el.closest('.TiMu')?.querySelector('h2.type_tit')?.textContent || '';
                const idx = matchType(sectionTitle + ' ' + el.textContent);
                if (idx !== -1) answerType = idx;
            }

            if (answerType === -1) {
                const hasOptions = el.querySelectorAll('.answerBg, .answer_li, [class*="option"], li[data]').length > 0;
                let hasBlanks = el.querySelectorAll(
                    '.Answer textarea, .Answer .tiankong, .Answer input[type="text"], ' +
                    '.blank_box input, .tkInput, input.cloze, .cloze input, ' +
                    '[class*="fillblank"] input, [class*="tiankong"] input, ' +
                    '.mark_name input[type="text"], .mark_name textarea'
                ).length > 0;

                if (!hasBlanks) {
                    let sib = el.nextElementSibling;
                    while (sib && !hasBlanks) {
                        if (sib.classList.contains('questionLi') || sib.classList.contains('TiMu')) break;
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
                if (!hasBlanks) {
                    const timu = el.closest('.TiMu') || el.parentElement;
                    if (timu) {
                        hasBlanks = timu.querySelectorAll('.Answer textarea, .Answer iframe, .Answer [contenteditable]').length > 0;
                    }
                }

                if (hasOptions && !hasBlanks) {
                    answerType = el.querySelectorAll('.answerBg, .answer_li, [class*="option"], li[data]').length === 2 ? 2 : 0;
                } else if (hasBlanks) {
                    answerType = 3;
                }
            }

            const correctedIdx = matchType(typeName);
            if (correctedIdx !== -1) answerType = correctedIdx;

            const titleEl = el.querySelector('h3.mark_name, .mark_name, h3, .questionTitle, [class*="title"]');
            let titleText = '';
            if (titleEl) {
                titleText = titleEl.textContent.trim()
                    .replace(/^\d+[.、．\s]*/, '')
                    .replace(/^【[^】]+】\s*/, '')
                    .replace(/^\[[^\]]+\]\s*/, '')
                    .replace(/^（[^）]+）\s*/, '')
                    .replace(/^\([^)]+\)\s*/, '')
                    .replace(/\s*\(.*?\)\s*$/, '')
                    .replace(/\s*（.*?）\s*$/, '');
                titleText = FontDecryptor.decrypt(titleText);
            }
            if (!titleText && titleEl) {
                titleText = titleEl.textContent.trim();
            }
            if (!titleText) return null;

            const options = [];
            let optionElements = el.querySelectorAll('.answerBg');
            if (!optionElements.length) optionElements = el.querySelectorAll('.answer_li, [class*="option"], li[data]');

            optionElements.forEach((opt, i) => {
                const labelEl = opt.querySelector('.num_option, [class*="label"], [class*="num"]');
                const textEl = opt.querySelector('.answer_p, [class*="answer"], [class*="content"], p');
                let label = labelEl ? labelEl.textContent.trim() : String.fromCharCode(65 + i);
                let text = textEl ? textEl.textContent.trim() : opt.textContent.trim();
                text = FontDecryptor.decrypt(text);
                const labelPattern = new RegExp(`^[${label}][.、．\\s]+`, 'i');
                text = text.replace(labelPattern, '');
                options.push({ label, text, element: opt });
            });

            const blanks = [];
            const blankSelectors = [
                '.blank_box input[type="text"], .blank_box textarea, .tkInput, input.cloze, .cloze input',
                '[class*="fillblank"] input, [class*="tiankong"] input, .Answer input[type="text"], .Answer textarea',
                '.Answer .tiankong + textarea, textarea[name^="answerEditor"], .edui-editor textarea, .edui-body-container, .Answer .edui-body-container',
                '.answer_content input[type="text"], .answer_content textarea, input[type="text"][name*="answer"], input[type="text"][name*="blank"], .blank input, [contenteditable="true"]'
            ];
            let blankElements = [];
            for (const sel of blankSelectors) {
                blankElements = el.querySelectorAll(sel);
                if (blankElements.length > 0) break;
            }

            blankElements.forEach((container, i) => {
                blanks.push({ index: i, element: container, tag: container.tagName.toLowerCase() });
            });

            if (blanks.length === 0) {
                let answerContainers = Array.from(el.querySelectorAll('.Answer, .answer_content, [class*="blank"], [class*="Blank"]'));
                if (answerContainers.length === 0) {
                    let sib = el.nextElementSibling;
                    while (sib && !sib.classList.contains('questionLi') && !sib.classList.contains('TiMu')) {
                        if (sib.classList.contains('Answer')) answerContainers.push(sib);
                        sib.querySelectorAll('.Answer, [class*="blank"]').forEach(a => answerContainers.push(a));
                        if (sib.querySelector('textarea, iframe, [contenteditable]')) answerContainers.push(sib);
                        sib = sib.nextElementSibling;
                    }
                }
                if (answerContainers.length === 0) {
                    const timu = el.closest('.TiMu') || el.parentElement;
                    if (timu) answerContainers = Array.from(timu.querySelectorAll('.Answer'));
                }

                answerContainers.forEach((container, i) => {
                    const target = container.querySelector('input[type="text"], textarea, .edui-body-container, [contenteditable], iframe') || container;
                    blanks.push({ index: i, element: target, tag: target.tagName.toLowerCase() });
                });
            }

            if (blanks.length === 0) {
                el.querySelectorAll('.mark_name input, .mark_name textarea, h3 input, h3 textarea, .questionTitle input, .questionTitle textarea, [class*="title"] input[type="text"], [class*="title"] textarea')
                    .forEach((container, i) => {
                        blanks.push({ index: i, element: container, tag: container.tagName.toLowerCase() });
                    });
            }

            const questionId = el.getAttribute('data') || el.getAttribute('data-id') || el.getAttribute('id') || '';
            const hiddenAnswer = questionId ? el.querySelector(`#answer${questionId}`) : null;

            if (blanks.length > 0 && options.length === 0 && answerType < 3) {
                answerType = 3;
            }

            return {
                index,
                element: el,
                questionId,
                answerType,
                typeName: QUESTION_TYPES[answerType] || '未知',
                title: titleText,
                options,
                blanks,
                hiddenAnswer,
            };
        },

        getSaveButton() {
            const doc = this._findQuestionDoc() || document;
            return doc.querySelector('a[onclick*="saveWork"]') ||
                   (doc.querySelector('a:last-child')?.textContent?.includes('保存') ? doc.querySelector('a:last-child') : null);
        },

        getSubmitButton() {
            const doc = this._findQuestionDoc() || document;
            return doc.querySelector('a[onclick*="submitValidate"]') ||
                   (doc.querySelector('a:last-child')?.textContent?.includes('提交') ? doc.querySelector('a:last-child') : null);
        }
    };

    // ==================== AI 调用 ====================
    const AIClient = {
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
                    onabort: function() {
                        reject(new Error('STOPPED'));
                    },
                    timeout: 30000,
                });
                Controller._currentXHR = xhr;
            });
        }
    };

    // ==================== 答案填写器 ====================
    const AnswerFiller = {
        parseAnswer(rawAnswer, question) {
            let answer = rawAnswer.trim()
                .replace(/^[：:]\s*/, '')
                .replace(/\s*[。.]\s*$/, '')
                .replace(/^["']|["']$/g, '');

            const type = question.answerType;
            switch (type) {
                case 0:
                    return this._parseChoiceAnswer(answer, question, false);
                case 1:
                    return this._parseChoiceAnswer(answer, question, true);
                case 2:
                    return this._parseJudgeAnswer(answer);
                case 3:
                    return this._parseBlankAnswer(answer, question);
                default:
                    return { type: 'text', content: answer };
            }
        },

        _parseChoiceAnswer(answer, question, isMulti) {
            let letters = [];
            if (isMulti) {
                const match = answer.match(/[A-Za-z]/g);
                if (match) {
                    letters = [...new Set(match.map(l => l.toUpperCase()))].sort();
                }
            } else {
                const match = answer.match(/[A-Za-z]/);
                if (match) {
                    letters = [match[0].toUpperCase()];
                }
            }

            if (letters.length === 0) {
                for (const opt of question.options) {
                    if (answer.includes(opt.text) || opt.text.includes(answer)) {
                        letters.push(opt.label.replace(/[^A-Z]/g, ''));
                    }
                }
            }
            return { type: isMulti ? 'multi' : 'single', letters };
        },

        _parseJudgeAnswer(answer) {
            const trueWords = ['正确', '是', '对', '√', 't', 'true', '对的', '正确答案'];
            const falseWords = ['错误', '否', '错', '×', 'f', 'false', '错的', '错误答案'];
            const lower = answer.toLowerCase();
            const isTrue = trueWords.some(w => lower.includes(w));
            const isFalse = falseWords.some(w => lower.includes(w));
            return { type: 'judge', value: isFalse ? false : true };
        },

        _parseBlankAnswer(answer, question) {
            let parts = answer.split('|||').map(s => s.trim()).filter(Boolean);
            if (question.blanks.length > 1 && parts.length === 1) {
                parts = answer.split(/[;；\n]/).map(s => s.trim()).filter(Boolean);
            }
            return { type: 'blank', parts };
        },

        async fill(question, parsedAnswer) {
            const type = question.answerType;
            Logger.info(`填写答案: 类型=${type}, 答案类型=${parsedAnswer.type}`);

            switch (type) {
                case 0:
                case 1:
                case 2:
                    await this._fillChoice(question, parsedAnswer);
                    break;
                case 3:
                    await this._fillBlank(question, parsedAnswer);
                    break;
                default:
                    if (parsedAnswer.type === 'blank') {
                        await this._fillBlank(question, parsedAnswer);
                    } else {
                        await this._fillText(question, parsedAnswer);
                    }
                    break;
            }
        },

        async _fillChoice(question, parsedAnswer) {
            const { type, letters, value } = parsedAnswer;
            if (type === 'judge') {
                const targetIndex = value ? 0 : 1;
                if (question.options[targetIndex]) {
                    this._clickOption(question.options[targetIndex].element);
                }
            } else {
                for (const letter of letters) {
                    const opt = question.options.find(o => o.label.toUpperCase().startsWith(letter.toUpperCase()));
                    if (opt) {
                        this._clickOption(opt.element);
                        await sleep(300);
                    }
                }
            }
        },

        _clickOption(element) {
            try {
                element.click();
            } catch (e) {
                try {
                    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                } catch (e2) {
                    element.dispatchEvent(new Event('click', { bubbles: true }));
                }
            }
        },

        async _fillBlank(question, parsedAnswer) {
            const { parts } = parsedAnswer;
            Logger.info(`填空题答案: ${JSON.stringify(parts)}, 空白数: ${question.blanks.length}`);

            if (!parts || parts.length === 0) return;

            let answerContainers = Array.from(question.element.querySelectorAll('.Answer'));
            if (answerContainers.length === 0) {
                let sibling = question.element.nextElementSibling;
                while (sibling && !sibling.classList.contains('questionLi') && !sibling.querySelector('.questionLi') && !sibling.classList.contains('TiMu')) {
                    if (sibling.classList.contains('Answer')) answerContainers.push(sibling);
                    sibling.querySelectorAll('.Answer').forEach(a => answerContainers.push(a));
                    sibling = sibling.nextElementSibling;
                }
            }

            if (answerContainers.length === 0) {
                const parent = question.element.closest('.TiMu') || question.element.parentElement;
                if (parent) answerContainers = Array.from(parent.querySelectorAll('.Answer'));
            }

            if (answerContainers.length > 0) {
                for (let i = 0; i < answerContainers.length; i++) {
                    const answer = parts[i] || parts[0] || '';
                    if (answer) {
                        try {
                            await this._fillSingleBlank(answerContainers[i], answer, question);
                        } catch (e) {
                            Logger.error(`填写第 ${i + 1} 个空失败: ${e.message}`);
                        }
                        await sleep(500);
                    }
                }
                this._notifyPlatform(question);
                return;
            }

            let blankElements = this._collectBlankElements(question);
            if (blankElements.length === 0) {
                await sleep(2000);
                blankElements = this._collectBlankElements(question);
            }
            if (blankElements.length === 0) {
                Logger.error('未找到任何填空输入元素');
                return;
            }

            for (let i = 0; i < Math.max(blankElements.length, parts.length); i++) {
                const answer = parts[i] || parts[0] || '';
                const el = blankElements[i];
                if (el && answer) {
                    try {
                        await this._fillSingleBlank(el.closest('.Answer') || el.parentElement, answer, question, el);
                    } catch (e) {
                        Logger.error(`填写第 ${i + 1} 个空失败: ${e.message}`);
                    }
                    await sleep(500);
                }
            }
            this._notifyPlatform(question);
        },

        _getUE(container) {
            try {
                const ownerDoc = container?.ownerDocument;
                if (ownerDoc && ownerDoc !== document) {
                    const allIframes = document.querySelectorAll('iframe');
                    for (const f of allIframes) {
                        try {
                            if (f.contentDocument === ownerDoc && f.contentWindow?.UE) {
                                return f.contentWindow.UE;
                            }
                        } catch (e) {}
                    }
                }
            } catch (e) {}

            try { if (typeof unsafeWindow !== 'undefined' && unsafeWindow.UE) return unsafeWindow.UE; } catch (e) {}
            try { if (typeof UE !== 'undefined') return UE; } catch (e) {}
            return null;
        },

        async _fillSingleBlank(container, text, question, fallbackElement) {
            if (!container) {
                if (fallbackElement) this._doSmartFill(fallbackElement, text);
                return;
            }

            const selectAndFill = async () => {
                const textarea = container.querySelector('textarea');
                if (textarea && textarea.id && await this._fillViaUEditor(textarea, text, container)) return true;

                const iframes = container.querySelectorAll('iframe');
                for (const iframe of iframes) {
                    try {
                        const body = iframe.contentDocument?.body;
                        if (body && (body.getAttribute('contenteditable') === 'true' || body.isContentEditable)) {
                            this._doFillContentEditable(body, text, iframe.contentWindow, iframe.contentDocument);
                            return true;
                        }
                    } catch (e) {}
                }

                for (const editable of container.querySelectorAll('[contenteditable="true"]')) {
                    if (editable.offsetParent !== null || editable.offsetWidth > 0) {
                        this._doFillContentEditable(editable, text);
                        return true;
                    }
                }

                const eduiBody = container.querySelector('.edui-body-container');
                if (eduiBody) {
                    this._doFillContentEditable(eduiBody, text);
                    return true;
                }

                const visibleInput = container.querySelector('input[type="text"]');
                if (visibleInput && visibleInput.offsetParent !== null) {
                    this._doSetInputValue(visibleInput, text);
                    return true;
                }

                if (textarea) {
                    this._doSetInputValue(textarea, text);
                    return true;
                }

                if (fallbackElement) {
                    this._doSmartFill(fallbackElement, text);
                    return true;
                }
                return false;
            };

            let filled = await selectAndFill();
            if (!filled) {
                await sleep(2000);
                filled = await selectAndFill();
            }

            if (filled) {
                this._syncToTextarea(container, text);
                this._syncToHiddenAnswer(question, text);
                Logger.success(`✓ 成功填写内容`);
            } else {
                const anyEditable = container.querySelector('input, textarea, [contenteditable]');
                if (anyEditable) {
                    this._doSmartFill(anyEditable, text);
                    this._syncToHiddenAnswer(question, text);
                } else {
                    Logger.error('容器内未找到任何可编辑元素');
                }
            }
        },

        _fillViaUEditor(textarea, text, container) {
            const ue = this._getUE(container || textarea);
            if (!ue || !textarea.id) return false;

            try {
                const editor = ue.getEditor(textarea.id);
                if (editor) {
                    if (editor.isReady) {
                        editor.setContent(text);
                    } else {
                        editor.ready(() => editor.setContent(text));
                    }
                    return true;
                }
            } catch (e) {}

            try {
                if (ue.instants) {
                    for (const key in ue.instants) {
                        const inst = ue.instants[key];
                        if (inst && (inst.textarea === textarea || inst.key === textarea.id || key.includes(textarea.id))) {
                            inst.setContent(text);
                            return true;
                        }
                    }
                }
            } catch (e) {}
            return false;
        },

        _syncToTextarea(container, text) {
            try {
                container.querySelectorAll('textarea').forEach(ta => {
                    try {
                        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                        nativeSetter.call(ta, text);
                    } catch (e) {
                        ta.value = text;
                    }
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                    ta.dispatchEvent(new Event('change', { bubbles: true }));
                });
            } catch (e) {}
        },

        _syncToHiddenAnswer(question, text) {
            if (!question) return;
            try {
                if (question.hiddenAnswer) {
                    question.hiddenAnswer.value = text;
                    question.hiddenAnswer.dispatchEvent(new Event('change', { bubbles: true }));
                }
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

        _collectBlankElements(question) {
            const blankElements = [];
            for (const b of question.blanks) {
                if (b.element?.isConnected) blankElements.push(b.element);
            }
            if (blankElements.length > 0) return blankElements;

            const selectors = [
                '.blank_box input[type="text"], .tkInput, input.cloze, [class*="fillblank"] input, [class*="tiankong"] input',
                '.Answer input[type="text"], .Answer textarea, textarea[name^="answerEditor"], .edui-body-container, [contenteditable="true"], textarea, input[type="text"]'
            ];
            for (const sel of selectors) {
                const found = question.element.querySelectorAll(sel);
                if (found.length > 0) return Array.from(found);
            }

            const parent = question.element.closest('.TiMu') || question.element.parentElement;
            if (parent) {
                const all = parent.querySelectorAll('.Answer textarea, .Answer input[type="text"], [contenteditable="true"], .edui-body-container');
                return Array.from(all).filter(el => !el.closest('#ai-answer-panel'));
            }
            return [];
        },

        _notifyPlatform(question) {
            if (!question?.questionId) return;
            try {
                const qId = question.questionId;
                const ownerDoc = question.element.ownerDocument;
                if (ownerDoc && ownerDoc !== document) {
                    const allIframes = document.querySelectorAll('iframe');
                    for (const f of allIframes) {
                        try {
                            if (f.contentDocument === ownerDoc && typeof f.contentWindow?.loadEditorAnswerd === 'function') {
                                f.contentWindow.loadEditorAnswerd(qId, 3);
                                return;
                            }
                        } catch (e) {}
                    }
                }
                if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.loadEditorAnswerd === 'function') {
                    unsafeWindow.loadEditorAnswerd(qId, 3);
                }
            } catch (e) {}
            try {
                question.element.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (e) {}
        },

        async _fillText(question, parsedAnswer) {
            const { content } = parsedAnswer;
            Logger.info(`文本题答案: ${content.substring(0, 50)}...`);

            let answerContainer = question.element.querySelector('.Answer');
            if (!answerContainer) {
                let sibling = question.element.nextElementSibling;
                while (sibling && !sibling.classList.contains('questionLi') && !sibling.classList.contains('TiMu')) {
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
                await this._fillSingleBlank(answerContainer, content, question);
                this._notifyPlatform(question);
                return;
            }

            let targetElement = question.blanks[0]?.element;
            if (!targetElement) {
                const selectors = ['textarea[name^="answerEditor"]', '.edui-body-container', '[contenteditable="true"]', 'textarea', 'input[type="text"]'];
                for (const sel of selectors) {
                    targetElement = question.element.querySelector(sel);
                    if (targetElement) break;
                }
            }

            if (targetElement) {
                const container = targetElement.closest('.Answer') || targetElement.closest('.answer_content') || targetElement.parentElement;
                if (container) {
                    await this._fillSingleBlank(container, content, null, targetElement);
                } else {
                    this._doSmartFill(targetElement, content);
                }
            }
            this._notifyPlatform(question);
        },

        _doFillContentEditable(element, text, win, doc) {
            const targetDoc = doc || element.ownerDocument || document;
            try { element.focus(); } catch (e) {}

            try {
                element.innerHTML = text;
            } catch (e) {
                try { element.textContent = text; } catch (e2) { return; }
            }

            try {
                const targetWin = win || targetDoc.defaultView || window;
                const sel = targetWin.getSelection();
                if (sel) {
                    const range = targetDoc.createRange();
                    range.selectNodeContents(element);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            } catch (e) {}

            try {
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                element.dispatchEvent(new Event('blur', { bubbles: true }));
            } catch (e) {}
        },

        _doSetInputValue(element, text) {
            try {
                const tag = element.tagName.toLowerCase();
                element.focus();
                element.dispatchEvent(new Event('focus', { bubbles: true }));

                try {
                    const proto = tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
                    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
                    nativeSetter.call(element, text);
                } catch (e) {
                    element.value = text;
                }

                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
                element.dispatchEvent(new Event('blur', { bubbles: true }));
                try { element.dispatchEvent(new CustomEvent('valuechange', { bubbles: true })); } catch (e) {}

                const parent = element.closest('.Answer') || element.closest('.answer_content') || element.parentElement;
                if (parent) {
                    const editable = parent.querySelector('[contenteditable="true"]');
                    if (editable && editable.offsetParent !== null) {
                        this._doFillContentEditable(editable, text);
                    }
                }
            } catch (e) {}
        }
    };

    // ==================== 主控制器 ====================
    const Controller = {
        _running: false,
        _abort: false,
        _progress: { current: 0, total: 0 },
        _currentXHR: null,

        _sleep(ms) {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    clearInterval(check);
                    resolve();
                }, ms);
                const check = setInterval(() => {
                    if (this._abort) {
                        clearTimeout(timer);
                        clearInterval(check);
                        reject(new Error('STOPPED'));
                    }
                }, 100);
            });
        },

        async start() {
            if (this._running) return;

            const apiKey = getApiKey();
            if (!apiKey) {
                Logger.error('请先配置 API Key！');
                showToast('⚠️ 请先在设置中配置并保存 API Key！', 3000);
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
                if (alreadyAnswered === questions.length) firstUnanswered = 1;
                if (startInput && !userModified) startInput.value = firstUnanswered;

                if (alreadyAnswered > 0) {
                    Logger.info(`检测到 ${alreadyAnswered} 道已答题目，将自动跳过`);
                }

                const userStart = parseInt(startInput?.value) || 1;
                const startFrom = Math.max(1, userStart);
                if (startFrom > 1) {
                    Logger.info(`从第 ${startFrom} 题开始（跳过前 ${startFrom - 1} 道已答题目）`);
                }

                let skipped = 0;
                for (let i = 0; i < questions.length; i++) {
                    if (this._abort) break;

                    const q = questions[i];
                    this._progress.current = i + 1;
                    this._updateProgress();

                    if (i + 1 < startFrom) {
                        skipped++;
                        continue;
                    }

                    if (this._isAnswered(q)) {
                        Logger.info(`[${i + 1}/${questions.length}] 跳过已答题目: ${q.title.substring(0, 30)}...`);
                        skipped++;
                        continue;
                    }

                    Logger.info(`[${i + 1}/${questions.length}] ${q.typeName}: ${q.title.substring(0, 30)}...`);

                    try {
                        const prompt = AIClient.buildPrompt(q);
                        Logger.info(`正在请求 ${CONFIG.provider === 'deepseek' ? 'DeepSeek' : 'MiMo'} AI...`);
                        const answer = await AIClient.call(prompt);

                        if (this._abort) break;

                        Logger.info(`AI 返回: ${answer.substring(0, 50)}`);
                        const parsed = AnswerFiller.parseAnswer(answer, q);
                        await AnswerFiller.fill(q, parsed);
                        Logger.success(`第 ${i + 1} 题已填写`);

                    } catch (e) {
                        if (e.message === 'STOPPED' || this._abort) break;
                        Logger.error(`第 ${i + 1} 题失败: ${e.message}`);
                    }

                    if (i < questions.length - 1 && !this._abort) {
                        try { await this._sleep(CONFIG.delay); } catch (e) { break; }
                    }
                }

                if (!this._abort) {
                    if (skipped > 0) Logger.info(`跳过已答题目: ${skipped} 道`);
                    Logger.success('所有题目处理完成！');
                    if (startInput) delete startInput.dataset.userModified;

                    // 弹出提示框提醒用户答题完成
                    showToast('🎉 答题完成！所有题目已处理完毕。', 3000);

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
                if (e.message !== 'STOPPED') Logger.error(`答题过程出错: ${e.message}`);
            } finally {
                this._running = false;
                this._abort = false;
                this._currentXHR = null;
                this._updateUI();
            }
        },

        _isAnswered(question) {
            const el = question.element;
            const type = question.answerType;
            if (!el || !el.isConnected) return false;

            if (type === 0 || type === 1 || type === 2) {
                if (el.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked')) {
                    Logger.info(`[检测] 题 ${question.index + 1} 已答: 匹配到已选中的原生 input`);
                    return true;
                }
                
                const selEl = el.querySelector('.check_answer, .answerBg_on, .on, .active, [class*="check_answer"], [class*="answerBg_on"]');
                if (selEl) {
                    Logger.info(`[检测] 题 ${question.index + 1} 已答: 匹配到选中态类名 (${selEl.className})`);
                    return true;
                }

                const options = el.querySelectorAll('.answerBg, .answer_li, li, [class*="option"]');
                for (const opt of options) {
                    if (/\b(check_answer|answerBg_on|active|on)\b/.test(opt.className || '')) {
                        Logger.info(`[检测] 题 ${question.index + 1} 已答: 选项匹配到类名 (${opt.className})`);
                        return true;
                    }
                    const subCheck = opt.querySelector('.check, .checked, .icon-check, [class*="check_icon"], [class*="selected"], input:checked');
                    if (subCheck) {
                        Logger.info(`[检测] 题 ${question.index + 1} 已答: 选项子元素匹配到标记 (.${subCheck.className})`);
                        return true;
                    }
                    if (['aria-checked', 'aria-selected', 'data-checked', 'data-selected'].some(attr => opt.getAttribute(attr) === 'true')) {
                        Logger.info(`[检测] 题 ${question.index + 1} 已答: 属性匹配`);
                        return true;
                    }
                }

                const answeredMark = el.querySelector('[class*="answered"], [class*="done"], [class*="complete"]');
                if (answeredMark) {
                    Logger.info(`[检测] 题 ${question.index + 1} 已答: 匹配到已答标记元素 (.${answeredMark.className})`);
                    return true;
                }
                if (el.getAttribute('data-answered') === 'true') {
                    Logger.info(`[检测] 题 ${question.index + 1} 已答: data-answered 属性为 true`);
                    return true;
                }
                return false;
            }

            if (type >= 3) {
                if (question.blanks?.length > 0) {
                    return question.blanks.some(b => {
                        const target = b.element;
                        if (!target) return false;
                        let text = '';
                        try {
                            text = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' ? target.value :
                                   target.tagName === 'IFRAME' ? (target.contentDocument?.body?.textContent || '') : target.textContent;
                        } catch (e) {}
                        return text && text.trim().length > 0;
                    });
                }
                const hasInputText = Array.from(el.querySelectorAll('textarea, input[type="text"]')).some(ta => ta.value && ta.value.trim().length > 0);
                const hasEditableText = Array.from(el.querySelectorAll('[contenteditable="true"], .edui-body-container')).some(ed => ed.textContent && ed.textContent.trim().length > 0);
                return hasInputText || hasEditableText;
            }
            return false;
        },

        stop() {
            this._abort = true;
            this._running = false;
            if (this._currentXHR?.abort) {
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
            if (stopBtn) stopBtn.style.display = this._running ? 'block' : 'none';
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
                const pct = this._progress.total > 0 ? (this._progress.current / this._progress.total * 100) : 0;
                bar.style.width = pct + '%';
            }
            if (text) text.textContent = `${this._progress.current} / ${this._progress.total}`;
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
        _panelWidth: 0,
        _panelHeight: 0,

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
                        
                        <!-- DeepSeek 配置组 -->
                        <div id="ai-deepseek-config-group">
                            <div class="config-group">
                                <label>DeepSeek API Key</label>
                                <input type="password" id="ai-deepseek-key" placeholder="sk-...">
                            </div>
                            <div class="config-group">
                                <label>DeepSeek 模型</label>
                                <select id="ai-deepseek-model">
                                    <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                                    <option value="deepseek-v4-flash">deepseek-v4-flash</option>
                                </select>
                            </div>
                        </div>

                        <!-- MiMo 配置组 -->
                        <div id="ai-mimo-config-group">
                            <div class="config-group">
                                <label>MiMo API Key</label>
                                <input type="password" id="ai-mimo-key" placeholder="sk-...">
                            </div>
                            <div class="config-group">
                                <label>MiMo 模型</label>
                                <select id="ai-mimo-model">
                                    <option value="mimo-v2.5-pro">mimo-v2.5-pro</option>
                                    <option value="mimo-v2.5">mimo-v2.5</option>
                                </select>
                            </div>
                        </div>

                        <div class="config-group">
                            <label>自定义 Endpoint（可选）</label>
                            <input type="text" id="ai-custom-endpoint" placeholder="留空使用默认">
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
            this._el.querySelectorAll('.tab-bar button').forEach(btn => {
                btn.addEventListener('click', () => {
                    this._el.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
                    this._el.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    btn.classList.add('active');
                    this._el.querySelector(`.tab-content[data-tab="${btn.dataset.tab}"]`).classList.add('active');
                });
            });

            document.getElementById('ai-collapse-btn').addEventListener('click', () => {
                this._el.classList.toggle('collapsed');
            });
            this._el.querySelector('.panel-header').addEventListener('click', (e) => {
                if (this._el.classList.contains('collapsed')) {
                    this._el.classList.remove('collapsed');
                }
            });

            const header = document.getElementById('ai-panel-header');
            header.addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'BUTTON') return;
                this._dragging = true;
                this._el.classList.add('dragging');
                document.body.classList.add('ai-dragging');
                const rect = this._el.getBoundingClientRect();
                this._offset.x = e.clientX - rect.left;
                this._offset.y = e.clientY - rect.top;
                this._panelWidth = rect.width;
                this._panelHeight = rect.height;
                e.preventDefault();
            });

            let mouseX = 0;
            let mouseY = 0;
            let tick = false;
            document.addEventListener('mousemove', (e) => {
                if (!this._dragging) return;
                mouseX = e.clientX;
                mouseY = e.clientY;
                if (!tick) {
                    window.requestAnimationFrame(() => {
                        if (this._dragging) {
                            let left = mouseX - this._offset.x;
                            let top = mouseY - this._offset.y;
                            
                            const viewportWidth = window.innerWidth;
                            const viewportHeight = window.innerHeight;
                            
                            left = Math.max(0, Math.min(left, viewportWidth - this._panelWidth));
                            top = Math.max(0, Math.min(top, viewportHeight - this._panelHeight));
                            
                            this._el.style.left = left + 'px';
                            this._el.style.top = top + 'px';
                            this._el.style.right = 'auto';
                        }
                        tick = false;
                    });
                    tick = true;
                }
            });

            document.addEventListener('mouseup', () => {
                if (this._dragging) {
                    this._dragging = false;
                    this._el.classList.remove('dragging');
                    document.body.classList.remove('ai-dragging');
                }
            });

            const startFromInput = document.getElementById('ai-start-from');
            if (startFromInput) {
                startFromInput.addEventListener('input', () => {
                    startFromInput.dataset.userModified = 'true';
                });
            }

            document.getElementById('ai-start-btn').addEventListener('click', () => {
                Controller.start();
            });

            document.getElementById('ai-stop-btn').addEventListener('click', () => {
                Controller.stop();
            });

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

            document.getElementById('ai-provider').addEventListener('change', (e) => {
                this._toggleProviderFields(e.target.value);
            });

            document.getElementById('ai-save-config').addEventListener('click', () => {
                this._saveConfig();
                Logger.success('设置已保存');
                showToast('✅ 设置已保存');
            });

            document.getElementById('ai-clear-log').addEventListener('click', () => {
                Logger.clear();
            });
        },

        _loadConfig() {
            const provider = CONFIG.provider;
            document.getElementById('ai-provider').value = provider;
            document.getElementById('ai-deepseek-key').value = CONFIG.deepseekKey;
            document.getElementById('ai-mimo-key').value = CONFIG.mimoKey;
            document.getElementById('ai-custom-endpoint').value = CONFIG.customEndpoint;
            document.getElementById('ai-deepseek-model').value = CONFIG.deepseekModel;
            document.getElementById('ai-mimo-model').value = CONFIG.mimoModel;
            document.getElementById('ai-delay').value = CONFIG.delay;
            document.getElementById('ai-auto-submit').checked = CONFIG.autoSubmit;
            this._toggleProviderFields(provider);
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

            GM_setValue('provider', CONFIG.provider);
            GM_setValue('deepseekKey', CONFIG.deepseekKey);
            GM_setValue('mimoKey', CONFIG.mimoKey);
            GM_setValue('customEndpoint', CONFIG.customEndpoint);
            GM_setValue('deepseekModel', CONFIG.deepseekModel);
            GM_setValue('mimoModel', CONFIG.mimoModel);
            GM_setValue('delay', CONFIG.delay);
            GM_setValue('autoSubmit', CONFIG.autoSubmit);
        },

        _toggleProviderFields(provider) {
            const dsGroup = document.getElementById('ai-deepseek-config-group');
            const mimoGroup = document.getElementById('ai-mimo-config-group');
            if (dsGroup && mimoGroup) {
                dsGroup.style.display = provider === 'deepseek' ? 'block' : 'none';
                mimoGroup.style.display = provider === 'mimo' ? 'block' : 'none';
            }
        }
    };

    // ==================== 油猴菜单 ====================
    GM_registerMenuCommand('⚙️ 打开设置', () => {
        const panel = document.getElementById('ai-answer-panel');
        if (panel) {
            panel.classList.remove('collapsed');
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
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
            return;
        }

        Panel.create();
        Logger.init(document.getElementById('ai-log-area'));
        Logger.success('AI 答题助手已加载');

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
