// ==UserScript==
// @name         学习通AI自动答题
// @namespace    http://tampermonkey.net/
// @version      1.1.1
// @description  调用DeepSeek/MiMo AI自动完成学习通作业和考试题目
// @author       You
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
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
                const hasBlanks = el.querySelectorAll('.Answer textarea, .Answer .tiankong').length > 0;
                if (hasOptions && !hasBlanks) {
                    // 有选项无填空 = 选择题或判断题
                    const optCount = el.querySelectorAll('.answerBg').length;
                    answerType = optCount === 2 ? 2 : 0; // 2个选项=判断题，否则=单选题
                } else if (hasBlanks && !hasOptions) {
                    answerType = 3; // 填空题
                }
            }

            if (!typeName && answerType >= 0) {
                typeName = QUESTION_TYPES[answerType] || '未知';
            }

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

            // 获取填空题区域 - 多种选择器
            const blanks = [];
            const blankSelectors = [
                '.Answer textarea',
                '.Answer .tiankong + textarea',
                'textarea[name^="answerEditor"]',
                '.edui-editor textarea',
                'textarea',
                'input[type="text"][name*="answer"]',
                '.blank input',
                '[contenteditable="true"]'
            ];

            let blankElements = [];
            for (const sel of blankSelectors) {
                blankElements = el.querySelectorAll(sel);
                if (blankElements.length > 0) break;
            }

            blankElements.forEach((container, i) => {
                blanks.push({ index: i, element: container, tag: container.tagName.toLowerCase() });
            });

            // 如果没找到填空元素，尝试从 .Answer 容器查找
            if (blanks.length === 0) {
                const answerContainers = el.querySelectorAll('.Answer, .answer_content, [class*="blank"]');
                answerContainers.forEach((container, i) => {
                    const textarea = container.querySelector('textarea') ||
                                    container.querySelector('input[type="text"]') ||
                                    container.querySelector('[contenteditable]');
                    if (textarea) {
                        blanks.push({ index: i, element: textarea, tag: textarea.tagName.toLowerCase() });
                    }
                });
            }

            // 获取隐藏的答案输入
            const questionId = el.getAttribute('data') || el.getAttribute('data-id') || el.getAttribute('id') || '';
            const hiddenAnswer = questionId ? el.querySelector(`#answer${questionId}`) : null;

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
                const match = answer.match(/[A-Z]/g);
                if (match) {
                    letters = [...new Set(match)].sort();
                }
            } else {
                // 单选题：取第一个字母
                const match = answer.match(/[A-Z]/);
                if (match) {
                    letters = [match[0]];
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

            // 如果 blanks 为空，尝试直接查找
            let blanks = question.blanks;
            if (blanks.length === 0) {
                Logger.warn('未找到填空元素，尝试重新查找...');
                const selectors = [
                    '.Answer textarea',
                    'textarea[name^="answerEditor"]',
                    '.Answer [contenteditable]',
                    '.edui-body-container',
                    'textarea',
                    'input[type="text"]'
                ];
                for (const sel of selectors) {
                    const elements = question.element.querySelectorAll(sel);
                    if (elements.length > 0) {
                        blanks = Array.from(elements).map((el, i) => ({ index: i, element: el }));
                        Logger.info(`通过 ${sel} 找到 ${blanks.length} 个填空元素`);
                        break;
                    }
                }
            }

            for (let i = 0; i < blanks.length; i++) {
                const blank = blanks[i];
                const answer = parts[i] || parts[0] || '';

                if (blank.element && answer) {
                    Logger.info(`填写第 ${i + 1} 个空: ${answer.substring(0, 30)}...`);
                    this._fillTextarea(blank.element, answer);
                    await sleep(500);
                }
            }

            // 通知平台编辑器更新
            try {
                if (typeof window.loadEditorAnswerd === 'function' && question.questionId) {
                    window.loadEditorAnswerd(question.questionId, 3);
                }
            } catch (e) {}

            // 触发全局 change 事件
            try {
                question.element.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (e) {}
        },

        async _fillText(question, parsedAnswer) {
            const { content } = parsedAnswer;
            Logger.info(`文本题答案: ${content.substring(0, 50)}...`);

            // 尝试多种方式找到输入元素
            let targetElement = null;

            // 方式1: 从 blanks 获取
            if (question.blanks.length > 0) {
                targetElement = question.blanks[0].element;
            }

            // 方式2: 直接查找
            if (!targetElement) {
                const selectors = [
                    '.Answer textarea',
                    'textarea[name^="answerEditor"]',
                    '.Answer [contenteditable]',
                    '.edui-body-container',
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

            // 通知平台
            try {
                if (typeof window.loadEditorAnswerd === 'function' && question.questionId) {
                    window.loadEditorAnswerd(question.questionId, question.answerType);
                }
            } catch (e) {}

            // 触发全局 change 事件
            try {
                question.element.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (e) {}
        },

        _fillTextarea(element, text) {
            const tag = element.tagName.toLowerCase();
            const isContentEditable = element.getAttribute('contenteditable') === 'true';

            Logger.info(`填写元素: <${tag}>, contenteditable=${isContentEditable}, id=${element.id || '无'}`);

            // 方式1: UEditor API（最可靠）
            try {
                // 查找 UEditor 实例
                if (typeof UE !== 'undefined') {
                    // 尝试通过 ID 获取
                    let editor = null;
                    if (element.id) {
                        editor = UE.getEditor(element.id);
                    }
                    // 尝试从父容器查找
                    if (!editor || !editor.ready) {
                        const editorContainer = element.closest('.edui-editor') || element.closest('[id^="edui"]');
                        if (editorContainer) {
                            const textarea = editorContainer.querySelector('textarea');
                            if (textarea && textarea.id) {
                                editor = UE.getEditor(textarea.id);
                            }
                        }
                    }
                    if (editor && editor.ready && editor.setContent) {
                        editor.setContent(text);
                        Logger.info('已通过 UEditor API 设置内容');
                        return;
                    }
                }
            } catch (e) {
                Logger.warn(`UEditor 方式失败: ${e.message}`);
            }

            // 方式2: 查找附近的 UEditor body container
            try {
                const answerDiv = element.closest('.Answer') || element.closest('.answer_content') || element.parentElement;
                if (answerDiv) {
                    const editorBody = answerDiv.querySelector('.edui-body-container') ||
                                      answerDiv.querySelector('.edui-body-container[contenteditable]');
                    if (editorBody) {
                        editorBody.innerHTML = `<p>${text}</p>`;
                        editorBody.dispatchEvent(new Event('input', { bubbles: true }));
                        editorBody.dispatchEvent(new Event('change', { bubbles: true }));
                        Logger.info('已通过 edui-body-container 设置内容');
                        return;
                    }
                }
            } catch (e) {
                Logger.warn(`edui-body 方式失败: ${e.message}`);
            }

            // 方式3: contenteditable 元素
            if (isContentEditable) {
                element.innerHTML = `<p>${text}</p>`;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                Logger.info('已通过 contenteditable 设置内容');
                return;
            }

            // 方式4: iframe 中的编辑器
            try {
                const answerDiv = element.closest('.Answer') || element.parentElement;
                if (answerDiv) {
                    const iframe = answerDiv.querySelector('iframe');
                    if (iframe && iframe.contentDocument) {
                        const body = iframe.contentDocument.body;
                        if (body) {
                            body.innerHTML = `<p>${text}</p>`;
                            body.dispatchEvent(new Event('input', { bubbles: true }));
                            Logger.info('已通过 iframe body 设置内容');
                            return;
                        }
                    }
                }
            } catch (e) {
                Logger.warn(`iframe 方式失败: ${e.message}`);
            }

            // 方式5: 标准 textarea/input
            if (tag === 'textarea' || tag === 'input') {
                // 使用原生输入模拟
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
                    'value'
                ).set;
                nativeInputValueSetter.call(element, text);

                // 触发完整的事件序列
                element.dispatchEvent(new Event('focus', { bubbles: true }));
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                element.dispatchEvent(new Event('blur', { bubbles: true }));
                Logger.info('已通过原生 setter 设置内容');
                return;
            }

            // 方式6: 兜底 - 直接设置
            element.value = text;
            element.innerHTML = text;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            Logger.info('已通过兜底方式设置内容');
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

                // 获取起始题号
                const startFrom = Math.max(1, parseInt(document.getElementById('ai-start-from')?.value) || 1);
                if (startFrom > 1) {
                    Logger.info(`从第 ${startFrom} 题开始`);
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

                    // 检查是否已答过
                    if (this._isAnswered(q)) {
                        skipped++;
                        continue;
                    }

                    Logger.info(`[${i + 1}/${questions.length}] ${q.typeName}: ${q.title.substring(0, 30)}...`);

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

            // 选择题/判断题：检查是否有选项被选中
            if (type === 0 || type === 1 || type === 2) {
                return el.querySelectorAll('.check_answer').length > 0;
            }

            // 填空题/简答题等：检查 textarea 是否有内容
            if (type >= 3) {
                const textareas = el.querySelectorAll('textarea');
                for (const ta of textareas) {
                    if (ta.value && ta.value.trim().length > 0) return true;
                }
                // 也检查 contenteditable 元素
                const editables = el.querySelectorAll('[contenteditable="true"]');
                for (const ed of editables) {
                    if (ed.textContent && ed.textContent.trim().length > 0) return true;
                }
                // 检查 UEditor
                const editorBodies = el.querySelectorAll('.edui-body-container');
                for (const body of editorBodies) {
                    if (body.textContent && body.textContent.trim().length > 0) return true;
                }
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
            // 实时更新起始题号，停止后可从下一题继续
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
                            <label>从第几题开始</label>
                            <input type="number" id="ai-start-from" value="1" min="1" placeholder="输入题号">
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
                            const blanks = el.querySelectorAll('.Answer textarea, textarea').length;
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
