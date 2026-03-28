// ---------- 全局变量 ----------
let currentItems = [];       // 笔记对象: { name, content, created, updated } (name/content 均为base64)
let editingIndex = -1;       // 当前正在编辑的索引，-1 表示新增模式
let isNewMode = false;

const DATA_URL = "https://luckyy.qzz.io/TextsDataBase/Notebook.json";
const WRITE_API = "https://gh-editor.luckyy.qzz.io/write";
const TARGET_FILE = "Notebook.json";

// DOM
const cardsGrid = document.getElementById('cardsGrid');
const refreshBtn = document.getElementById('refreshBtn');
const uploadBtn = document.getElementById('uploadBtn');
const apiKeyInput = document.getElementById('apiKeyInput');
const rememberKeyCheckbox = document.getElementById('rememberKeyCheckbox');
const liveStatusSpan = document.getElementById('liveStatus');
const globalMsgDiv = document.querySelector('#globalMessageContainer .global-message');
const themeToggleBtn = document.getElementById('themeToggleBtn');

const editorPanel = document.getElementById('editorPanel');
const panelTitle = document.getElementById('panelTitle');
const editTitleInput = document.getElementById('editTitle');
const editContentTextarea = document.getElementById('editContent');
const savePanelBtn = document.getElementById('savePanelBtn');
const cancelPanelBtn = document.getElementById('cancelPanelBtn');
const closePanelBtn = document.getElementById('closePanelBtn');
const panelErrorDiv = document.getElementById('panelError');
const displayCreatedSpan = document.getElementById('displayCreated');
const displayUpdatedSpan = document.getElementById('displayUpdated');

// ---------- Base64 编解码 (支持中文) ----------
function encodeBase64(str) {
    if (!str) return "";
    try {
        return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode('0x' + p1)));
    } catch (e) { return ""; }
}
function decodeBase64(encoded) {
    if (!encoded) return "";
    try {
        const binary = atob(encoded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
        try { return decodeURIComponent(escape(atob(encoded))); } catch(e2) { return "[解码错误]"; }
    }
}

// 格式化时间戳 (数字或ISO字符串)
function formatTimestamp(ts) {
    if (!ts) return "未知";
    let date = new Date(ts);
    if (isNaN(date.getTime())) return "无效时间";
    return date.toLocaleString('zh-CN', { hour12: false });
}

// 显示全局消息 (恢复延迟10秒)
let msgTimeout = null;
function showMessage(msg, isError = false) {
    if (msgTimeout) clearTimeout(msgTimeout);
    if (globalMsgDiv) {
        globalMsgDiv.innerHTML = isError ? `⚠️ ${msg}` : `✓ ${msg}`;
        globalMsgDiv.style.background = isError ? 'rgba(220,107,92,0.2)' : 'rgba(112,192,0,0.15)';
        msgTimeout = setTimeout(() => {
            if (globalMsgDiv.innerHTML === `✓ ${msg}` || globalMsgDiv.innerHTML === `⚠️ ${msg}`) {
                globalMsgDiv.innerHTML = `✨ 点击卡片编辑笔记，编辑完成后上传～`;
                globalMsgDiv.style.background = '';
            }
        }, 3000);
    }
    liveStatusSpan.innerHTML = isError ? `✕ ${msg.substring(0, 30)}` : `✓ ${msg.substring(0, 30)}`;
    // if (!isError) {
        // setTimeout(() => {
            // if (liveStatusSpan.innerHTML.includes(msg.substring(0,30))) liveStatusSpan.innerHTML = `💬 笔记系统就绪`;
        // }, 10000);
    // }
}

function showLoading(loading = true) {
    liveStatusSpan.innerHTML = loading ? `<span class="loading-spinner"></span> 处理中...` : `💬 笔记系统就绪`;
}

function escapeHtml(str) { return str ? str.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])) : ''; }
function truncatePreview(text, maxLen = 70) {
    if (!text) return '';
    return text.length <= maxLen ? text : text.slice(0, maxLen - 3) + '...';
}

// 获取预览内容 (解码)
function getPreviewContent(item) {
    const rawContent = item.content ? decodeBase64(item.content) : "";
    if (!rawContent.trim()) return "— 无内容 —";
    const plain = rawContent.replace(/\n/g, ' ');
    return truncatePreview(plain, 70);
}

// 渲染卡片网格 (包含更新时间展示)
function renderCards() {
    if (!cardsGrid) return;
    cardsGrid.innerHTML = '';
    // 新增卡片
    const addCard = document.createElement('div');
    addCard.className = 'card add-card';
    addCard.innerHTML = `<div class="add-content"><span>+</span><span>新建笔记</span></div>`;
    addCard.addEventListener('click', () => {
        hideEditorPanel();
        editingIndex = -1;
        isNewMode = true;
        showEditorPanelForNew();
    });
    cardsGrid.appendChild(addCard);

    currentItems.forEach((item, idx) => {
        const card = document.createElement('div');
        card.className = 'card';
        const decodedTitle = item.name ? decodeBase64(item.name) : "未命名笔记";
        const titleDisplay = decodedTitle.trim() === "" ? "未命名笔记" : decodedTitle;
        const previewText = getPreviewContent(item);
        const hasContent = item.content && decodeBase64(item.content).trim() !== "";
        const updatedStr = item.updated ? formatTimestamp(item.updated) : "未知";

        card.innerHTML = `
            <div class="card-header">
                <div class="card-name">${escapeHtml(titleDisplay)}</div>
                <button class="delete-btn-card" data-idx="${idx}" title="删除笔记">${`<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`}</button>
            </div>
            <div class="card-updated">上次编辑：${escapeHtml(updatedStr)}</div>
            <div class="card-preview">
                ${!hasContent ? '<span class="empty-preview">( 暂无内容，点击编辑 )</span>' : escapeHtml(previewText)}
            </div>
        `;
        card.addEventListener('click', (e) => {
            if (e.target.closest('.delete-btn-card')) return;
            hideEditorPanel();
            editingIndex = idx;
            isNewMode = false;
            showEditorPanelForEdit(idx);
        });
        const delBtn = card.querySelector('.delete-btn-card');
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`确定要删除笔记「${titleDisplay}」吗？`)) {
                currentItems.splice(idx, 1);
                renderCards();
                showMessage(`删除了一条笔记 · 记得上传哦～`, false);
                if (editingIndex === idx) hideEditorPanel();
            }
        });
        cardsGrid.appendChild(card);
    });
}

// 隐藏编辑面板并恢复卡片网格显示
function hideEditorPanel() {
    editorPanel.classList.remove('active');
    cardsGrid.classList.remove('hide-grid');
    panelErrorDiv.classList.remove('show');
    editingIndex = -1;
    isNewMode = false;
}

// 显示新增面板 (清空日期占位)
function showEditorPanelForNew() {
    panelTitle.textContent = "新建笔记";
    editTitleInput.value = "";
    editContentTextarea.value = "";
    displayCreatedSpan.textContent = "新建后将自动生成";
    displayUpdatedSpan.textContent = "新建后将自动生成";
    clearPanelErrors();
    cardsGrid.classList.add('hide-grid');   // 隐藏笔记列表
    editorPanel.classList.add('active');
    editTitleInput.focus();
}

// 显示编辑面板 (填充数据及时间)
function showEditorPanelForEdit(index) {
    const item = currentItems[index];
    if (!item) return;
    panelTitle.textContent = "编辑笔记";
    const decodedTitle = item.name ? decodeBase64(item.name) : "";
    editTitleInput.value = decodedTitle;
    const decodedContent = item.content ? decodeBase64(item.content) : "";
    editContentTextarea.value = decodedContent;
    displayCreatedSpan.textContent = item.created ? formatTimestamp(item.created) : "未知";
    displayUpdatedSpan.textContent = item.updated ? formatTimestamp(item.updated) : "未知";
    clearPanelErrors();
    cardsGrid.classList.add('hide-grid');
    editorPanel.classList.add('active');
    editTitleInput.focus();
}

function clearPanelErrors() {
    panelErrorDiv.classList.remove('show');
    panelErrorDiv.textContent = '';
}

// 保存当前编辑 (新增或更新)
function saveCurrentNote() {
    clearPanelErrors();
    let rawTitle = editTitleInput.value.trim();
    let rawContent = editContentTextarea.value;
    
    const finalTitleBase64 = encodeBase64(rawTitle === "" ? "未命名笔记" : rawTitle);
    const encodedContent = encodeBase64(rawContent);
    const now = Date.now();
    
    if (isNewMode) {
        currentItems.push({
            name: finalTitleBase64,
            content: encodedContent,
            created: now,
            updated: now
        });
        showMessage(`创建了一条笔记 · 记得上传哦～`, false);
    } else {
        if (editingIndex < 0 || editingIndex >= currentItems.length) {
            hideEditorPanel();
            return;
        }
        // 保留原有 created 不变
        const originalCreated = currentItems[editingIndex].created || now;
        currentItems[editingIndex] = {
            name: finalTitleBase64,
            content: encodedContent,
            created: originalCreated,
            updated: now
        };
        showMessage(`更新了一条笔记 · 记得上传哦～`, false);
    }
    hideEditorPanel();
    renderCards();
}

// ---------- 数据加载 (读取 Notebook.txt) ----------
async function loadFromRemote() {
    showLoading(true);
    try {
        const separator = DATA_URL.includes('?') ? '&' : '?';
        const cacheBustedUrl = `${DATA_URL}${separator}_t=${Date.now()}`;
        const resp = await fetch(cacheBustedUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        let text = await resp.text();
        let data;
        try { data = JSON.parse(text); } catch(e) { data = []; }
        if (!Array.isArray(data)) throw new Error('数据格式不是数组');
        // 规范化：确保每个笔记都有 name(encoded), content(encoded), created, updated
        currentItems = data.map(item => ({
            name: (item.name && typeof item.name === 'string') ? item.name : encodeBase64("未命名笔记"),
            content: (item.content && typeof item.content === 'string') ? item.content : encodeBase64(""),
            created: (item.created && !isNaN(new Date(item.created).getTime())) ? item.created : Date.now(),
            updated: (item.updated && !isNaN(new Date(item.updated).getTime())) ? item.updated : Date.now()
        }));
        renderCards();
        showMessage(`加载成功，共 ${currentItems.length} 条笔记`, false);
    } catch (err) {
        console.error(err);
        showMessage(`加载失败: ${err.message}，使用空列表`, true);
        currentItems = [];
        renderCards();
    } finally {
        showLoading(false);
    }
}

async function handleRefresh() {
    if (currentItems.length > 0 && !confirm("未上传的更改将不会保存，确定要重新加载吗？")) return;
    await loadFromRemote();
    hideEditorPanel();
}

async function uploadData() {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) { showMessage("请填写 API Key", true); apiKeyInput.focus(); return; }
    if (rememberKeyCheckbox.checked) localStorage.setItem('saved_api_key', apiKey);
    else localStorage.removeItem('saved_api_key');
    
    const payload = { file: TARGET_FILE, content: JSON.stringify(currentItems, null, 2) };
    showLoading(true);
    try {
        const response = await fetch(WRITE_API, {
            method: 'POST',
            headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        let result;
        const ct = response.headers.get('content-type');
        if (ct?.includes('application/json')) result = await response.json();
        else result = await response.text();
        if (!response.ok) throw new Error(`上传失败 (${response.status}): ${JSON.stringify(result)}`);
        showMessage(`上传成功！已同步 ${currentItems.length} 条笔记`, false);
    } catch (err) {
        console.error(err);
        showMessage(`上传出错: ${err.message}`, true);
    } finally {
        showLoading(false);
    }
}

function initApiStorage() {
    const saved = localStorage.getItem('saved_api_key');
    if (saved) { apiKeyInput.value = saved; rememberKeyCheckbox.checked = true; }
    rememberKeyCheckbox.addEventListener('change', (e) => {
        if (!e.target.checked) localStorage.removeItem('saved_api_key');
        else if (apiKeyInput.value.trim()) localStorage.setItem('saved_api_key', apiKeyInput.value.trim());
    });
    apiKeyInput.addEventListener('input', () => {
        if (rememberKeyCheckbox.checked) {
            const val = apiKeyInput.value.trim();
            val ? localStorage.setItem('saved_api_key', val) : localStorage.removeItem('saved_api_key');
        }
    });
}

function initTheme() {
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark');
        themeToggleBtn.innerHTML = '🔆 浅色模式';
    }
    themeToggleBtn.addEventListener('click', () => {
        const isDark = document.body.classList.toggle('dark');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        themeToggleBtn.innerHTML = isDark ? '🔆 浅色模式' : '🌕 深色模式';
    });
}

function bindEvents() {
    refreshBtn.addEventListener('click', handleRefresh);
    uploadBtn.addEventListener('click', uploadData);
    savePanelBtn.addEventListener('click', saveCurrentNote);
    cancelPanelBtn.addEventListener('click', hideEditorPanel);
    closePanelBtn.addEventListener('click', hideEditorPanel);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && editorPanel.classList.contains('active')) hideEditorPanel();
    });
}

async function init() {
    initApiStorage();
    initTheme();
    bindEvents();
    await loadFromRemote();
}

init();
