// ==UserScript==
// @name         Trakt.tv | Fake VIP + Filters
// @description  Unlock VIP features, remove ads, persist filters, advanced filter presets with rename/delete
// @version      1.0.1
// @namespace    https://github.com/MentalBlank/TraktFilterUserscript
// @author       MentalBlank
// @license      GPL-3.0-or-later
// @match        *://trakt.tv/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_addStyle
// @icon         https://www.google.com/s2/favicons?sz=64&domain=trakt.tv
// @updateURL    https://raw.githubusercontent.com/MentalBlank/TraktFilterUserscript/main/TraktFilterUserscript.js
// @downloadURL  https://raw.githubusercontent.com/MentalBlank/TraktFilterUserscript/main/TraktFilterUserscript.js
// ==/UserScript==

'use strict';
let $, compressedCache;

// ------------------- Styles -------------------
GM_addStyle(`
    #top-nav .btn-vip,
    .dropdown-menu.for-sortable > li > a.vip-only,
    .alert-vip-required,
    .vip-expiring.alert.alert-danger,
    .btn-primary-vip,
    a.btn.btn-primary.btn-primary-vip,
    a.btn.btn-primary.more-left[href*="/mir"] {
        display: none !important;
    }
    .preset-link { display:block; margin:2px 0; position:relative; }
    .preset-link button { margin-left:5px; font-size:10px; padding:1px 3px; }
    .preset-link-text.selected { color: var(--brand-primary-300) !important; }
    .preset-link-text { color:white; text-decoration:none; }
`);

// ------------------- VIP Unlock -------------------
document.addEventListener('turbo:load', async () => {
    $ ??= unsafeWindow.jQuery;
    compressedCache ??= unsafeWindow.compressedCache;
    if (!$ || !compressedCache) return;

    patchUserSettings();

    $('body').removeAttr('data-turbo');
    $('.frame-wrapper .sidenav.advanced-filters .buttons')
        .addClass('vip')
        .find('.btn.vip')
        .text('').removeClass('vip').removeAttr('href')
        .addClass('disabled disabled-init').attr('id', 'filter-apply').attr('data-apply-text', 'Apply Filters')
        .before('<a class="btn btn-close-2024" id="filter-close" style="display:inline-block !important; visibility:visible !important;">Close</a>')
        .append('<span class="text">Configure Filters</span><span class="icon fa-solid fa-check"></span>');

    $('#om1gYCfRiN-IGJj59JMAC-wrapper, #om1gYCfRiN-IGJj59JMAC-xVRiWHDe6J').remove();
    $('div[id^="om1gYCfRiN-"]').has('.om1gYCfRiN-deefp').remove();

    saveFiltersFromCookies();
    await reapplyFilters();
    saveAdvancedFilters();
    await reapplyAdvancedFilters();
    renderPresets();
});

// ------------------- VIP Patch -------------------
function patchUserSettings() {
    const userSettings = compressedCache.get('settings');
    if (userSettings && (!userSettings.user.vip)) {
        userSettings.user.vip = true;
        compressedCache.set('settings', userSettings);
        if (unsafeWindow.userSettings) unsafeWindow.userSettings = userSettings;
    }
}

// ------------------- IndexedDB Helpers -------------------
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('trakt_filters', 2);
        req.onerror = () => reject(req.error);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('filters')) db.createObjectStore('filters', { keyPath: 'name' });
            if (!db.objectStoreNames.contains('presets')) db.createObjectStore('presets', { keyPath: 'name' });
        };
        req.onsuccess = () => resolve(req.result);
    });
}

async function setFilter(name, value) {
    const db = await openDB();
    const tx = db.transaction('filters', 'readwrite');
    tx.objectStore('filters').put({ name, value });
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getFilter(name) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('filters', 'readonly');
        const req = tx.objectStore('filters').get(name);
        req.onsuccess = () => resolve(req.result?.value);
        req.onerror = () => reject(req.error);
    });
}

async function getAllFilters() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('filters', 'readonly');
        const store = tx.objectStore('filters');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

// ------------------- Presets Helpers -------------------
async function savePreset(name, params) {
    const db = await openDB();
    const tx = db.transaction('presets', 'readwrite');
    tx.objectStore('presets').put({ name, params });
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getAllPresets() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('presets', 'readonly');
        const req = tx.objectStore('presets').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

async function deletePreset(name) {
    const db = await openDB();
    const tx = db.transaction('presets', 'readwrite');
    tx.objectStore('presets').delete(name);
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ------------------- Render Presets -------------------
async function renderPresets() {
    const presets = await getAllPresets();
    const nav = $('nav');
    if (!nav.length) return;

    nav.find('#filters-header, .filter-presets').remove();

    let savedState = localStorage.getItem('trakt_filters_collapsed') === 'true';
    const header = $(`<h3 id="filters-header" style="cursor:pointer; margin-top:10px;">FILTERS</h3>`);
    const container = $('<div class="filter-presets" style="margin:5px 0;"></div>');
    container.css('display', savedState ? 'none' : 'block');
    header.on('click', () => {
        container.slideToggle(150);
        localStorage.setItem('trakt_filters_collapsed', !container.is(':visible'));
    });

    const saveBtn = $('<div class="link"><a href="#" style="color:#00bfff; display:block; margin:2px 0;">Save Current Filters</a></div>');
    saveBtn.find('a').on('click', async e => {
        e.preventDefault();
        const name = prompt('Enter preset name:');
        if (!name) return;

        const params = Object.fromEntries(
            [...new URLSearchParams(location.search).entries()].filter(([k]) => k !== 'page')
        );

        const cookies = document.cookie.split(';');
        const cookieFilters = {};
        cookies.forEach(cookie => {
            const [cName, ...rest] = cookie.split('=');
            const value = rest.join('=').trim();
            if (cName.trim().startsWith('filter-')) cookieFilters[cName.trim()] = value;
        });

        const presetFilters = { ...params, ...cookieFilters };
        await savePreset(name, presetFilters);
        renderPresets();
        alert(`Preset "${name}" saved!`);
    });

    container.append(saveBtn);

    const currentParams = { ...Object.fromEntries(new URLSearchParams(location.search).entries()) };
    document.cookie.split(';').forEach(cookie => {
        const [cName, ...rest] = cookie.split('=');
        const value = rest.join('=').trim();
        if (cName.trim().startsWith('filter-')) currentParams[cName.trim()] = value;
    });

    presets.forEach(preset => {
        const isApplied = JSON.stringify(preset.params) === JSON.stringify(currentParams);
        const linkWrapper = $(`
            <div class="link preset-link" style="display:flex; align-items:center; justify-content:space-between;">
                <a href="#" class="preset-link-text ${isApplied ? 'selected' : ''}" style="flex:1; color:${isApplied ? 'var(--brand-primary-300) !important' : 'white'};">${preset.name}</a>
                <span style="flex:none; margin-left:5px;">
                    <button class="rename" title="Rename">✏️</button>
                    <button class="delete" title="Delete">🗑️</button>
                </span>
            </div>
        `);

        linkWrapper.find('a').on('click', e => {
            e.preventDefault();
            applyPreset(preset.params);
        });

        linkWrapper.find('.rename').on('click', async e => {
            e.preventDefault();
            const newName = prompt('Enter new name:', preset.name);
            if (!newName) return;
            await deletePreset(preset.name);
            await savePreset(newName, preset.params);
            renderPresets();
        });

        linkWrapper.find('.delete').on('click', async e => {
            e.preventDefault();
            if (!confirm(`Delete preset "${preset.name}"?`)) return;
            await deletePreset(preset.name);
            renderPresets();
        });

        container.append(linkWrapper);
    });

    nav.append(header);
    nav.append(container);
}

// ------------------- Apply Preset -------------------
function applyPreset(params) {
    Object.entries(params).forEach(([k, v]) => {
        if (k.startsWith('filter-')) {
            document.cookie = `${k}=${v}; path=/; domain=${location.hostname}`;
        }
    });

    const url = new URL(location.href);

    url.searchParams.delete('page');
    Object.entries(params).forEach(([k, v]) => {
        if (!k.startsWith('filter-') && k !== 'page') url.searchParams.set(k, v);
    });

    if (unsafeWindow.Turbo) {
        unsafeWindow.Turbo.visit(url.toString());
    } else {
        location.href = url.toString();
    }
}

// ------------------- Cookie Filters -------------------
function saveFiltersFromCookies() {
    const cookies = document.cookie.split(';');
    cookies.forEach(cookie => {
        const [name, ...rest] = cookie.split('=');
        const value = rest.join('=').trim();
        if (name.trim().startsWith('filter-')) setFilter(name.trim(), value);
    });
}

async function reapplyFilters() {
    const filters = await getAllFilters();
    filters.forEach(f => {
        if (!f.name.startsWith('advanced-')) {
            document.cookie = `${f.name}=${f.value}; path=/; domain=${location.hostname}`;
        }
    });
}

// ------------------- Advanced Filters via URL -------------------
function saveAdvancedFilters() {
    const params = new URLSearchParams(location.search);
    if ([...params].length === 0) return;

    params.delete('page');

    const filters = Object.fromEntries(params.entries());
    setFilter('advanced-filters', JSON.stringify(filters));
}

async function reapplyAdvancedFilters() {
    const advanced = await getFilter('advanced-filters');
    if (!advanced) return;
    const filters = JSON.parse(advanced);
    $('a[href^="/movies/"], a[href^="/shows/"]').each((_, el) => {
        const $el = $(el);
        const url = new URL($el.prop('href'), location.origin);
        Object.entries(filters).forEach(([k,v]) => url.searchParams.set(k,v));
        $el.prop('href', url.toString());
    });
}
