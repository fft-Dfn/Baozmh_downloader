// ==UserScript==
// @name         baozmh_downloader_to_cbz_Pro
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  使用 fflate 引擎在包子漫画目录页打包下载 CBZ，彻底解决假死问题
// @author       fft-Dfn & Gemini
// @match        https://www.baozimh.com/comic/*
// @match        https://www.twmanga.com/comic/*
// @grant        GM_xmlhttpRequest
// @require      https://unpkg.com/fflate@0.8.2/umd/index.js
// @updateURL    https://raw.githubusercontent.com/fft-Dfn/Baozmh_downloader/main/baozmh_downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/fft-Dfn/Baozmh_downloader/main/baozmh_downloader.user.js
// ==/UserScript==

(function() {
    'use strict';
    /* global fflate */

    // --- 配置 ---
    const CONCURRENCY = 3; // 并发数可以稍微调高一点，fflate 性能很好

    const style = document.createElement('style');
    style.innerHTML = `
        .download-btn {
            margin-left: 10px;
            padding: 2px 8px;
            background-color: #0088cc;
            color: white;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            border: none;
            display: inline-block;
            vertical-align: middle;
            transition: background-color 0.2s;
        }
        .download-btn:hover { background-color: #005580; }
        .download-btn.loading { background-color: #f39c12; cursor: wait; }
        .download-btn.error { background-color: #e74c3c; }
        .download-btn.success { background-color: #2ecc71; }
    `;
    document.head.appendChild(style);

    function injectButtons() {
        const mangaName = document.querySelector('h1.comic-title')?.innerText.trim() || 'Manga';
        const chapterLinks = document.querySelectorAll('.chapter-item a, .comics-chapters a');

        chapterLinks.forEach(link => {
            if (link.dataset.hasDownloadBtn) return;
            link.dataset.hasDownloadBtn = "true";

            const btn = document.createElement('button');
            btn.className = 'download-btn';
            btn.innerText = '打包CBZ';
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                startDownload(link.href, link.innerText.trim(), mangaName, btn);
            };
            link.parentNode.insertBefore(btn, link.nextSibling);
        });
    }

    async function startDownload(chapterUrl, chapterName, mangaName, btn) {
        if (btn.classList.contains('loading')) return;

        if (typeof fflate === 'undefined') {
            alert('fflate 引擎加载失败，请检查网络！');
            updateBtn(btn, '引擎缺失', 'error');
            return;
        }

        updateBtn(btn, '解析中...', 'loading');

        try {
            const html = await fetchHtml(chapterUrl);
            const doc = new DOMParser().parseFromString(html, 'text/html');

            const imgElements = doc.querySelectorAll('.comic-contain amp-img, .comic-contain img');
            const rawUrls = Array.from(imgElements).map(img => img.getAttribute('src') || img.getAttribute('data-src')).filter(src => src);
            const imageUrls = [...new Set(rawUrls)];

            if (imageUrls.length === 0) throw new Error('未找到图片');

            let downloadedCount = 0;
            const total = imageUrls.length;

            // 这是 fflate 要求的格式： { "文件名": 字节数据 }
            const zipFiles = {};
            console.log(`[抓取开始] 准备下载 ${total} 张图片...`);

            await asyncPool(CONCURRENCY, imageUrls, async (url, index) => {
                const ext = url.split('.').pop().split('?')[0] || 'jpg';
                const fileName = `${String(index + 1).padStart(3, '0')}.${ext}`;

                // 直接获取最原始的二进制 ArrayBuffer
                const arrayBuffer = await fetchImageBuffer(url, chapterUrl);

                // 转换为 fflate 需要的 Uint8Array
                zipFiles[fileName] = new Uint8Array(arrayBuffer);

                downloadedCount++;
                updateBtn(btn, `抓取 [${downloadedCount}/${total}]`, 'loading');
            });

            console.log('[抓取完成] 正在调用 fflate 同步打包...');
            updateBtn(btn, '极速打包中...', 'loading');

            // ★ 核心突围：使用 fflate 同步方法 (zipSync) 瞬间拼接数据，level: 0 表示不压缩（速度最快）
            const outBuffer = fflate.zipSync(zipFiles, { level: 0 });

            console.log('[打包完成] 正在生成文件...');
            const finalBlob = new Blob([outBuffer], { type: "application/zip" });
            const fullFileName = `${mangaName}_${chapterName}.cbz`;

            saveAs(finalBlob, fullFileName);

            updateBtn(btn, '完成', 'success');
            setTimeout(() => updateBtn(btn, '打包CBZ', ''), 3000);

        } catch (err) {
            console.error('[运行出错]', err);
            updateBtn(btn, '失败', 'error');
        }
    }

    // --- 底层网络与文件工具 ---
    function updateBtn(btn, text, statusClass) {
        btn.innerText = text;
        btn.className = `download-btn ${statusClass}`;
    }

    function fetchHtml(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                timeout: 10000,
                onload: (res) => resolve(res.responseText),
                onerror: () => reject('HTML获取失败')
            });
        });
    }

    function fetchImageBuffer(url, referer) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                headers: { "Referer": referer },
                responseType: "arraybuffer", // 关键：获取纯二进制内存
                timeout: 20000,
                onload: (res) => {
                    if (res.status === 200) resolve(res.response);
                    else reject(`HTTP ${res.status}`);
                },
                onerror: () => reject('图片网络错误')
            });
        });
    }

    function saveAs(blob, fileName) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 1000);
    }

    async function asyncPool(poolLimit, array, iteratorFn) {
        const ret = [];
        const executing = [];
        for (const [index, item] of array.entries()) {
            const p = Promise.resolve().then(() => iteratorFn(item, index));
            ret.push(p);
            if (poolLimit <= array.length) {
                const e = p.then(() => executing.splice(executing.indexOf(e), 1));
                executing.push(e);
                if (executing.length >= poolLimit) {
                    await Promise.race(executing);
                }
            }
        }
        return Promise.all(ret);
    }

    setTimeout(injectButtons, 1000);
    const observer = new MutationObserver(injectButtons);
    observer.observe(document.body, { childList: true, subtree: true });

})();
