// ==UserScript==
// @name         Amazon to Value Books Checker
// @name:ja      Amazon to バリューブックス
// @namespace    https://github.com/codespaces/new/kamijyojapan/amazon-to-valuebooks
// @version      1.0.0
// @description  Amazonの書籍詳細ページでバリューブックスの在庫と価格を自動検索し、結果を表示します。
// @author       You
// @license      MIT
// @match        https://www.amazon.co.jp/*
// @connect      www.valuebooks.jp
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // --- 設定 ---
    const RETRY_DELAY = 500; 
    const SIMILARITY_THRESHOLD = 0.35; 

    // --- 1. 情報取得 ---
    const titleElement = document.getElementById('productTitle');
    if (!titleElement) return;

    const rawTitle = titleElement.innerText.trim();
    
    // 基本クリーニング
    let cleanTitle = rawTitle
        .replace(/[\(（【\[](?![0-9０-９\.]+(?:\s*巻)?[\)）】\]]).+?[\)）】\]]/g, '') 
        .replace(/:\s*本/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    // シンプルタイトル
    let simpleTitle = cleanTitle.split(/[:：～~－\-\u2014]/)[0].trim();
    const volMatch = cleanTitle.match(/([0-9０-９\.]+(?:\s*巻)?)$/);
    if (volMatch && !simpleTitle.includes(volMatch[1])) {
        simpleTitle = `${simpleTitle} ${volMatch[1]}`;
    }

    // 作者名取得
    let authorName = "";
    const byline = document.getElementById('bylineInfo');
    if (byline) {
        const authorLink = byline.querySelector('a.a-link-normal');
        if (authorLink) {
            authorName = authorLink.innerText.trim();
        } else {
            authorName = byline.innerText
                .replace(/\(著\)|（著）|\(編集\)|（編集）|著者：/g, '')
                .split(/,|、/)[0].trim();
        }
    }

    // --- 検索実行フロー ---
    const searchWordL1 = authorName ? `"${cleanTitle}" ${authorName}` : `"${cleanTitle}"`;
    
    searchValueBooks(searchWordL1, cleanTitle, (result1) => {
        if (result1) {
            processResult(result1);
            return;
        }

        if (searchWordL1 !== `"${cleanTitle}"`) {
            setTimeout(() => {
                searchValueBooks(`"${cleanTitle}"`, cleanTitle, (result2) => {
                    if (result2) {
                        processResult(result2);
                        return;
                    }
                    runFuzzySearch(); 
                });
            }, RETRY_DELAY);
        } else {
            runFuzzySearch();
        }
    });

    function runFuzzySearch() {
        setTimeout(() => {
            searchValueBooks(cleanTitle, cleanTitle, (result3) => {
                if (result3) {
                    processResult(result3);
                    return;
                }
                if (simpleTitle.length > 1 && simpleTitle !== cleanTitle) {
                    setTimeout(() => {
                        searchValueBooks(simpleTitle, cleanTitle, (result4) => {
                            if (result4) {
                                processResult(result4);
                            } else {
                                noHit();
                            }
                        });
                    }, RETRY_DELAY);
                } else {
                    noHit();
                }
            });
        }, RETRY_DELAY);
    }

    function noHit() {
        showSearchBar(cleanTitle);
    }

    function processResult(item) {
        const isInStock = !!item.price;
        showNotificationBar(item, isInStock);
    }

    // API検索 & 検証
    function searchValueBooks(keyword, originalTitle, callback) {
        const apiUrl = `https://www.valuebooks.jp/api/search?page=1&search_word=${encodeURIComponent(keyword)}&conditions_stock=0`;

        GM_xmlhttpRequest({
            method: "GET",
            url: apiUrl,
            headers: {
                "Accept": "application/json, text/plain, */*",
                "User-Agent": navigator.userAgent
            },
            onload: function(response) {
                if (response.status === 200) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.items && data.items.length > 0) {
                            const item = data.items[0];
                            const score = calculateSimilarity(originalTitle, item.title);
                            
                            if (score >= SIMILARITY_THRESHOLD) {
                                callback({
                                    price: item.min_sell_price,
                                    title: item.title,
                                    id: item.vs_catalog_id,
                                    code: item.productCode,
                                    keyword: keyword
                                });
                            } else {
                                callback(null);
                            }
                        } else {
                            callback(null);
                        }
                    } catch (e) {
                        callback(null);
                    }
                } else {
                    callback(null);
                }
            },
            onerror: function() { callback(null); }
        });
    }

    // 類似度計算
    function calculateSimilarity(s1, s2) {
        const n1 = normalizeString(s1);
        const n2 = normalizeString(s2);
        if (n1.length > 2 && n2.length > 2) {
            if (n1.includes(n2) || n2.includes(n1)) return 1.0;
        }
        const distance = levenshteinDistance(n1, n2);
        const maxLength = Math.max(n1.length, n2.length);
        if (maxLength === 0) return 1.0;
        return 1.0 - (distance / maxLength);
    }

    function normalizeString(str) {
        return str.toLowerCase()
            .replace(/[！-～]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
            .replace(/\s+/g, '')
            .replace(/・|:|：|~|～/g, '');
    }

    function levenshteinDistance(a, b) {
        const matrix = [];
        for (let i = 0; i <= b.length; i++) matrix[i] = [i];
        for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
                }
            }
        }
        return matrix[b.length][a.length];
    }

    // UI表示
    function showNotificationBar(item, isInStock) {
        if (document.getElementById('vb-notify-bar')) return;

        const priceText = isInStock ? `${Number(item.price).toLocaleString()}円` : "在庫なし";
        let linkUrl = `https://www.valuebooks.jp/search?keyword=${encodeURIComponent(item.keyword)}&conditions_stock=0`;
        if (item.id) {
            linkUrl = `https://www.valuebooks.jp/bp/${item.id}`;
        }

        const bar = document.createElement('div');
        bar.id = 'vb-notify-bar';
        
        let barStyle = `
            padding: 12px 16px;
            margin: 15px 0;
            border-radius: 3px;
            font-family: "Amazon Ember", Arial, sans-serif;
            font-size: 14px;
            display: flex;
            flex-wrap: wrap; 
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-decoration: none;
            cursor: pointer;
            transition: all 0.2s ease;
            z-index: 1000;
            box-sizing: border-box;
        `;

        if (isInStock) {
            barStyle += `background-color: #f0fdf4; border: 1px solid #27ae60; border-left: 6px solid #27ae60; color: #333;`;
        } else {
            barStyle += `background-color: #f5f5f5; border: 1px solid #999; border-left: 6px solid #999; color: #666;`;
        }
        
        bar.style.cssText = barStyle;
        const dispTitle = item.title.length > 30 ? item.title.substring(0, 30) + "..." : item.title;
        
        const mainMessage = isInStock 
            ? `<span style="font-weight: bold; color: #27ae60; font-size: 15px;">バリューブックス在庫あり</span>`
            : `<span style="font-weight: bold; color: #666; font-size: 15px;">バリューブックス：現在在庫切れ</span>`;

        const priceDisplay = isInStock
            ? `<span style="color:#d32f2f; font-weight:bold; font-size:16px; margin-left:8px;">${priceText}</span>`
            : ``;

        bar.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; flex: 1 1 200px;">
                <span style="font-size: 18px;">${isInStock ? '📚' : '📖'}</span>
                <div>
                    <div style="display:flex; flex-wrap:wrap; align-items:baseline; gap: 4px;">
                        ${mainMessage}
                        ${priceDisplay}
                    </div>
                    <div style="font-size: 11px; color: #666; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 90%;">
                        一致: ${dispTitle}
                    </div>
                </div>
            </div>
            <div style="
                background: ${isInStock ? '#27ae60' : '#999'}; 
                color: white; 
                padding: 6px 14px; 
                border-radius: 20px; 
                font-size: 12px; 
                font-weight: bold;
                white-space: nowrap;
                flex: 0 0 auto;
            ">
                ${isInStock ? 'サイトへ ↗' : '詳細 ↗'}
            </div>
        `;

        bar.addEventListener('click', () => window.open(linkUrl, '_blank'));
        insertBar(bar);
    }

    // UI: 手動検索バー
    function showSearchBar(defaultKeyword) {
        if (document.getElementById('vb-notify-bar')) return;

        const bar = document.createElement('div');
        bar.id = 'vb-notify-bar';

        bar.style.cssText = `
            background-color: #e3f2fd;
            border: 1px solid #2196f3;
            border-left: 6px solid #2196f3;
            color: #333;
            padding: 10px 16px;
            margin: 15px 0;
            border-radius: 3px;
            font-family: "Amazon Ember", Arial, sans-serif;
            font-size: 14px;
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            z-index: 1000;
            box-sizing: border-box;
        `;

        bar.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; flex: 1 1 200px;">
                <span style="font-size: 18px;">🔍</span>
                <span style="font-weight: bold; color: #1565c0; font-size: 13px; white-space: nowrap;">
                    バリューブックス検索:
                </span>
                <input type="text" id="vb-manual-input" value="${defaultKeyword}" style="
                    flex: 1;
                    min-width: 100px;
                    padding: 6px 8px;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                    font-size: 13px;
                    box-sizing: border-box;
                ">
            </div>
            <button id="vb-manual-btn" style="
                background: #1976d2; 
                color: white; 
                padding: 6px 14px; 
                border: none;
                border-radius: 20px; 
                font-size: 12px; 
                font-weight: bold;
                white-space: nowrap;
                cursor: pointer;
                flex: 0 0 auto;
                margin-left: auto;
            ">
                検索 ↗
            </button>
        `;

        insertBar(bar);

        const input = document.getElementById('vb-manual-input');
        const btn = document.getElementById('vb-manual-btn');

        const doSearch = () => {
            const val = input.value.trim();
            if (val) {
                const url = `https://www.valuebooks.jp/search?keyword=${encodeURIComponent(val)}&conditions_stock=0`;
                window.open(url, '_blank');
            }
        };

        btn.addEventListener('click', doSearch);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') doSearch();
        });
        input.addEventListener('click', (e) => e.stopPropagation());
    }

    function insertBar(element) {
        const targetId = 'globalStoreInfoBullets_feature_div';
        const targetElement = document.getElementById(targetId);

        if (targetElement) {
            targetElement.parentNode.insertBefore(element, targetElement);
        } else {
            const titleSection = document.getElementById('titleSection') || document.getElementById('centerCol');
            if (titleSection) {
                 titleSection.parentNode.insertBefore(element, titleSection.nextSibling);
            } else {
                document.body.prepend(element);
            }
        }
    }

})();