// ==UserScript==
// @name         baozmh_downloader
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  在包子漫画目录页添加下载按钮，静默解析当前章节图片并下载
// @author       fft-Dfn
// @match        https://www.baozimh.com/comic/*
// @match        https://www.twmanga.com/comic/*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @updateURL    https://raw.githubusercontent.com/fft-Dfn/Baozmh_downloader/main/baozmh_downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/fft-Dfn/Baozmh_downloader/main/baozmh_downloader.user.js
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置参数 ---
    const CONCURRENCY = 3; // 章节内同时下载的图片数量

    // --- 样式注入 ---
    const style = document.createElement('style');
    style.innerHTML = `
        .download-btn {
            margin-left: 10px;
            padding: 2px 8px;
            background-color: #ff4500;
            color: white;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            border: none;
            display: inline-block;
            vertical-align: middle;
        }
        .download-btn:hover { background-color: #ff6347; }
        .download-btn.loading { background-color: #ffa500; cursor: wait; }
        .download-btn.error { background-color: #ff0000; }
        .download-btn.success { background-color: #4caf50; }
    `;
    document.head.appendChild(style);

    // --- 核心逻辑 ---

    // 1. 寻找章节列表并注入按钮
    function injectButtons() {
        const mangaName = document.querySelector('h1.comic-title')?.innerText.trim() || 'Manga';
        const chapterLinks = document.querySelectorAll('.chapter-item a, .comics-chapters a');

        chapterLinks.forEach(link => {
            if (link.dataset.hasDownloadBtn) return;
            link.dataset.hasDownloadBtn = "true";

            const btn = document.createElement('button');
            btn.className = 'download-btn';
            btn.innerText = '下载';
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                startDownload(link.href, link.innerText.trim(), mangaName, btn);
            };
            link.parentNode.insertBefore(btn, link.nextSibling);
        });
    }

    // 2. 开始下载流程
    async function startDownload(chapterUrl, chapterName, mangaName, btn) {
        if (btn.classList.contains('loading')) return;

        updateBtn(btn, '解析中...', 'loading');

        try {
            // 获取章节页面源码
            const html = await fetchHtml(chapterUrl);
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // 提取图片地址（🌟修复点1：严格限定只在主体盒子内寻找，防止抓取广告）
            const imgElements = doc.querySelectorAll('.comic-contain amp-img, .comic-contain img');
            // 提取所有链接
            const rawUrls = Array.from(imgElements).map(img => img.getAttribute('src') || img.getAttribute('data-src')).filter(src => src);

            // 🌟修复点2：使用 Set 魔法进行去重，剔除 noscript 里的备胎图
            const imageUrls = [...new Set(rawUrls)];

            if (imageUrls.length === 0) throw new Error('未找到图片');

            let downloadedCount = 0;
            const total = imageUrls.length;
            updateBtn(btn, `[0/${total}]`, 'loading');

            // 并发控制下载
            await asyncPool(CONCURRENCY, imageUrls, async (url, index) => {
                const ext = url.split('.').pop().split('?')[0] || 'jpg';
                const fileName = `${mangaName}_${chapterName}_${String(index + 1).padStart(3, '0')}.${ext}`;
                await downloadImage(url, fileName, chapterUrl);
                downloadedCount++;
                updateBtn(btn, `[${downloadedCount}/${total}]`, 'loading');
            });

            updateBtn(btn, '完成', 'success');
        } catch (err) {
            console.error(err);
            updateBtn(btn, '失败', 'error');
        }
    }

    // --- 工具函数 ---

    function updateBtn(btn, text, statusClass) {
        btn.innerText = text;
        btn.className = `download-btn ${statusClass}`;
    }

    function fetchHtml(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: (res) => resolve(res.responseText),
                onerror: (err) => reject(err)
            });
        });
    }

    function downloadImage(url, fileName, referer) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                headers: { "Referer": referer },
                responseType: "blob",
                onload: (res) => {
                    if (res.status !== 200) return reject();
                    const blobUrl = window.URL.createObjectURL(res.response);
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    a.download = fileName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(blobUrl);
                    resolve();
                },
                onerror: () => reject()
            });
        });
    }

    // 并发池函数
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

    // 初始化
    setTimeout(injectButtons, 1000);
    const observer = new MutationObserver(injectButtons);
    observer.observe(document.body, { childList: true, subtree: true });

})();
