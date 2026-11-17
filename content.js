console.log("GForm AutoFill Content Script Loaded");

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const normalizeText = (text) => (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');

let isHandlingConfirmation = false;
let isAutomationRunning = false;

initAutoLoop();

/**
 * Cek apakah halaman saat ini merupakan halaman form (memiliki pertanyaan atau form aktif)
 */
function isFormPage() {
    const cards = document.querySelectorAll('div[role="listitem"], .Qr7Oae, .geS5n');
    if (cards.length > 0) return true;

    // Cek jika halaman merupakan bagian form (misal halaman pembuka multi-section yang hanya punya tombol Berikutnya)
    const formElem = document.querySelector('form#mG61Hd, form[action*="formResponse"]');
    const navBtn = document.querySelector('.appsMaterialWewebAnimateFormbuttonNavButton, .uArJ5e[role="button"]');
    const confirmElem = document.querySelector('.freebirdFormviewerViewResponseConfirmationMessage, .vHW8D, .freebirdFormviewerViewResponseLinksContainer, .c2gzEf');
    if (formElem && navBtn && !confirmElem) {
        return true;
    }

    return false;
}

function isAlreadyRespondedPage() {
    const cards = document.querySelectorAll('div[role="listitem"], .Qr7Oae, .geS5n');
    if (cards.length > 0) return false;

    const pageText = (document.body ? document.body.textContent : '').toLowerCase();
    return pageText.includes("anda sudah mengisi") ||
           pageText.includes("anda sudah menanggapi") ||
           pageText.includes("you've already responded") ||
           pageText.includes("you have already responded");
}

/**
 * Cek apakah halaman saat ini merupakan halaman konfirmasi setelah submit
 */
function isConfirmationPage() {
    // Jika masih ada kartu pertanyaan, berarti ini halaman form (bukan halaman konfirmasi)
    const cards = document.querySelectorAll('div[role="listitem"], .Qr7Oae, .geS5n');
    if (cards.length > 0) return false;

    if (isAlreadyRespondedPage()) return false;

    const confirmationElem = document.querySelector(
        '.freebirdFormviewerViewResponseConfirmationMessage, .vHW8D, .freebirdFormviewerViewResponseLinksContainer, .c2gzEf'
    );
    if (confirmationElem) return true;

    // Jika URL masih di /viewform dan tidak ada elemen konfirmasi, berarti bukan halaman konfirmasi
    if (window.location.pathname.includes('/viewform')) return false;

    const pageText = (document.body ? document.body.textContent : '').toLowerCase();
    if (
        pageText.includes("tanggapan anda telah direkam") ||
        pageText.includes("jawaban anda telah direkam") ||
        pageText.includes("your response has been recorded") ||
        pageText.includes("kirim tanggapan lain") ||
        pageText.includes("kirim jawaban lain") ||
        pageText.includes("masukan jawaban lain") ||
        pageText.includes("masukkan jawaban lain") ||
        pageText.includes("submit another response")
    ) {
        return true;
    }

    // Jika URL sudah berpindah ke /formResponse dan bukan halaman form, anggap halaman konfirmasi
    if (window.location.pathname.includes('/formResponse') && !isFormPage()) {
        return true;
    }

    return false;
}

/**
 * Tunggu sampai halaman terdeteksi sebagai halaman form atau halaman konfirmasi
 */
async function waitForPageState(timeout = 10000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        if (isAlreadyRespondedPage()) {
            return 'already_responded';
        }
        if (isFormPage()) {
            await delay(400);
            return 'form';
        }
        if (isConfirmationPage()) {
            await delay(300);
            return 'confirmation';
        }
        await delay(250);
    }
    return null;
}

/**
 * Tunggu sampai elemen form muncul di DOM
 */
async function waitForFormReady(timeout = 10000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        if (isFormPage()) {
            await delay(400);
            return true;
        }
        await delay(250);
    }
    return false;
}

/**
 * Set nilai input teks/textarea menggunakan prototype setter bawaan browser
 * agar Google Forms mendeteksi perubahan nilai dan tidak mengosongkannya kembali.
 */
function setNativeInputValue(element, value) {
    if (!element) return;
    element.focus();

    const isTextarea = element instanceof HTMLTextAreaElement || element.tagName === 'TEXTAREA';
    const prototype = isTextarea 
        ? window.HTMLTextAreaElement.prototype 
        : window.HTMLInputElement.prototype;
    
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) {
        descriptor.set.call(element, value);
    } else {
        element.value = value;
    }

    // Trigger event agar form closure/framework merespons
    element.dispatchEvent(new Event('focus', { bubbles: true }));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
}

/**
 * Klik elemen UI secara natural (simulasi mouse down, up, dan native click)
 */
function selectElement(element) {
    if (!element) return;
    try {
        element.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    } catch (e) {}

    element.focus();

    const mouseEventInit = { bubbles: true, cancelable: true, view: window };
    element.dispatchEvent(new MouseEvent('pointerdown', mouseEventInit));
    element.dispatchEvent(new MouseEvent('mousedown', mouseEventInit));
    element.dispatchEvent(new MouseEvent('pointerup', mouseEventInit));
    element.dispatchEvent(new MouseEvent('mouseup', mouseEventInit));

    if (typeof element.click === 'function') {
        element.click();
    } else {
        element.dispatchEvent(new MouseEvent('click', mouseEventInit));
    }

    element.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Ambil daftar kartu pertanyaan tanpa duplikasi wrapper
 */
function getQuestionCards() {
    let cards = Array.from(document.querySelectorAll('div[role="listitem"], .Qr7Oae'));
    if (cards.length === 0) {
        cards = Array.from(document.querySelectorAll('.geS5n'));
    }
    return cards.filter(card => !cards.some(other => other !== card && other.contains(card)));
}

/**
 * Ekstrak teks judul pertanyaan dari kartu
 */
function getQuestionHeading(card) {
    const headingElem = card.querySelector('[role="heading"], .M7eMe, .HoPnJf, .F9g2ud, .freebirdFormviewerViewItemsItemItemTitle');
    if (headingElem) {
        const clone = headingElem.cloneNode(true);
        clone.querySelectorAll('*[aria-hidden="true"], .v3DuG').forEach(el => el.remove());
        return clone.textContent.trim();
    }
    return '';
}

/**
 * Ekstrak base path form (tanpa /viewform atau /formResponse) untuk mencocokkan form yang sama
 */
function getFormBasePath(urlString) {
    try {
        const url = new URL(urlString, window.location.origin);
        return url.origin + url.pathname.replace(/\/(viewform|formResponse).*$/, '');
    } catch (e) {
        return '';
    }
}

/**
 * Bangun URL /viewform yang bersih untuk refresh ke iterasi berikutnya
 */
function buildCleanViewFormUrl(urlString) {
    try {
        const url = new URL(urlString, window.location.origin);
        if (url.pathname.includes('/formResponse')) {
            url.pathname = url.pathname.replace(/\/formResponse.*$/, '/viewform');
        }
        url.searchParams.delete('fbzx');
        url.searchParams.delete('pageHistory');
        return url.toString();
    } catch (e) {
        return window.location.href;
    }
}

/**
 * Simpan URL /viewform saat ini ke storage agar refresh selalu kembali ke awal form yang sama
 */
async function ensureFormUrlSaved(existingFormUrl = null, forceUpdate = false) {
    if (!window.location.pathname.includes('/viewform')) return;

    const currentBase = getFormBasePath(window.location.href);
    const savedBase = existingFormUrl ? getFormBasePath(existingFormUrl) : '';

    if (forceUpdate || !existingFormUrl || currentBase !== savedBase) {
        const cleanUrl = buildCleanViewFormUrl(window.location.href);
        await chrome.storage.local.set({ formUrl: cleanUrl });
    }
}

/**
 * Tentukan URL tujuan refresh setelah form berhasil dikirim
 */
function getFormReloadUrl(savedFormUrl) {
    if (savedFormUrl && savedFormUrl.includes('/viewform')) {
        const currentBase = getFormBasePath(window.location.href);
        const savedBase = getFormBasePath(savedFormUrl);
        if (currentBase && currentBase === savedBase) {
            return savedFormUrl;
        }
    }
    return buildCleanViewFormUrl(window.location.href);
}

/**
 * Tunggu konfirmasi pengiriman selesai, lalu langsung refresh halaman form
 * untuk melanjutkan ke iterasi berikutnya tanpa perlu klik "Masukan Jawaban Lain".
 */
async function waitForConfirmationAndContinue(currentIndex, totalData, maxWaitMs = 20000) {
    if (isHandlingConfirmation) return true;
    isHandlingConfirmation = true;

    try {
        console.log(`[Auto-Loop] Menunggu konfirmasi pengiriman sebelum refresh (Iterasi #${currentIndex + 1} dari ${totalData})...`);
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitMs) {
            if (isAlreadyRespondedPage()) {
                await chrome.storage.local.set({ loopActive: false });
                alert(`Berhenti pada data #${currentIndex + 1} dari ${totalData}. Formulir membatasi pengisian hanya 1 kali.`);
                return true;
            }

            if (!isConfirmationPage()) {
                await delay(300);
                continue;
            }

            // Pastikan user tidak menekan STOP saat menunggu konfirmasi
            const freshStorage = await chrome.storage.local.get(["loopActive", "currentIndex", "responses", "formUrl"]);
            if (!freshStorage.loopActive) {
                console.log("[Auto-Loop] Otomatisasi dihentikan oleh user sebelum refresh.");
                return true;
            }

            const activeIndex = typeof freshStorage.currentIndex === 'number' ? freshStorage.currentIndex : currentIndex;
            const total = (freshStorage.responses && freshStorage.responses.length) || totalData;

            if (activeIndex < total - 1) {
                const nextIndex = activeIndex + 1;
                await chrome.storage.local.set({ currentIndex: nextIndex });
                console.log(`[Auto-Loop] Pengiriman selesai! Refresh halaman untuk iterasi #${nextIndex + 1} dari ${total}...`);

                await delay(400);

                const targetUrl = getFormReloadUrl(freshStorage.formUrl);
                const currentNoHash = window.location.href.split('#')[0];
                const targetNoHash = targetUrl.split('#')[0];

                if (currentNoHash === targetNoHash) {
                    window.location.reload();
                } else {
                    window.location.href = targetUrl;
                }
            } else {
                await chrome.storage.local.set({ loopActive: false });
                console.log(`[Auto-Loop] Selesai! Semua ${total} jawaban telah terisi.`);
                alert(`Sukses! Semua jawaban (${total}/${total}) telah berhasil diisi dan dikirim.`);
            }
            return true;
        }

        return false;
    } finally {
        isHandlingConfirmation = false;
    }
}

/**
 * Inisialisasi loop pengisian otomatis saat halaman dimuat
 */
async function initAutoLoop() {
    const dataStorage = await chrome.storage.local.get(["responses", "currentIndex", "loopActive", "formUrl"]);
    const responses = dataStorage.responses || [];
    const currentIndex = dataStorage.currentIndex || 0;
    const loopActive = dataStorage.loopActive || false;

    if (!loopActive || responses.length === 0) return;

    await delay(300);

    const pageState = await waitForPageState(12000);

    if (pageState === 'already_responded') {
        await chrome.storage.local.set({ loopActive: false });
        alert(`Berhenti pada data #${currentIndex + 1} dari ${responses.length}. Formulir membatasi pengisian hanya 1 kali.`);
        return;
    }

    // Jika sedang berada di halaman konfirmasi respons (setelah submit)
    if (pageState === 'confirmation') {
        await waitForConfirmationAndContinue(currentIndex, responses.length, 12000);
        return;
    }

    if (pageState === 'form') {
        const freshStorage = await chrome.storage.local.get(["responses", "currentIndex", "loopActive", "formUrl"]);
        if (!freshStorage.loopActive) return;

        await ensureFormUrlSaved(freshStorage.formUrl);

        const activeIndex = freshStorage.currentIndex || 0;
        const currentData = (freshStorage.responses || [])[activeIndex];
        if (currentData) {
            console.log(`[Auto-Loop] Mengisi data #${activeIndex + 1} dari ${freshStorage.responses.length} pada form.`);
            await delay(400);
            await runFormAutomation(currentData);
        }
    } else {
        console.warn("[Auto-Loop] Form atau halaman konfirmasi tidak ditemukan atau waktu muat habis.");
    }
}

/**
 * Listener pesan dari popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "FILL_FORM") {
        console.log("Memicu proses fill form dari popup...");
        
        sendResponse({ status: "started" });

        (async () => {
            try {
                await ensureFormUrlSaved(null, true);

                let currentData = message.data;
                if (!currentData) {
                    const dataStorage = await chrome.storage.local.get(["responses", "currentIndex"]);
                    const responses = dataStorage.responses || [];
                    const currentIndex = dataStorage.currentIndex || 0;
                    currentData = responses[currentIndex];
                }

                if (currentData) {
                    await runFormAutomation(currentData);
                }
            } catch (err) {
                console.error("Gagal mengisi form:", err);
            }
        })();
        
        return true;
    }
});

/**
 * Jalankan proses isi form beserta navigasi auto-submit jika aktif
 */
async function runFormAutomation(currentData) {
    if (!currentData || isAutomationRunning) return;
    isAutomationRunning = true;

    let action = null;
    let loopActive = false;
    let currentIndex = 0;
    let totalData = 0;

    try {
        const initialStorage = await chrome.storage.local.get(["formUrl"]);
        await ensureFormUrlSaved(initialStorage.formUrl);

        await fillAllQuestions(currentData);

        const dataStorage = await chrome.storage.local.get(["loopActive", "currentIndex", "responses"]);
        loopActive = dataStorage.loopActive || false;
        currentIndex = dataStorage.currentIndex || 0;
        totalData = (dataStorage.responses || []).length;

        if (loopActive) {
            await delay(600);
            action = handleFormNavigation();
        } else {
            console.log("Form berhasil diisi! Menunggu user mengirim secara manual.");
        }
    } finally {
        isAutomationRunning = false;
    }

    if (loopActive) {
        // 1. Jika tombol 'Berikutnya' diklik (halaman multi-bagian)
        if (action === 'next') {
            console.log("[Auto-Loop] Berpindah ke bagian berikutnya, menunggu transisi halaman...");
            await delay(1200);
            const ready = await waitForFormReady(8000);
            if (ready) {
                await delay(400);
                await runFormAutomation(currentData);
            }
        }
        // 2. Jika tombol 'Kirim' / 'Submit' diklik
        else if (action === 'submit') {
            console.log("[Auto-Loop] Form telah disubmit, menunggu konfirmasi sebelum refresh...");
            await delay(600);
            await waitForConfirmationAndContinue(currentIndex, totalData, 20000);
        }
    }
}

function isGridRowMatch(row, cleanTarget) {
    const cleanRowText = normalizeText(row.textContent);
    return Boolean(
        cleanRowText &&
        (cleanRowText.includes(cleanTarget) || cleanTarget.includes(cleanRowText.slice(0, 35)))
    );
}

function isCardEligible(card) {
    if (card.getAttribute('data-gform-filled') === 'true') return false;
    const radiogroups = card.querySelectorAll('[role="radiogroup"]');
    if (radiogroups.length > 1) return false;
    if (radiogroups.length === 1 && radiogroups[0].getAttribute('data-gform-filled') === 'true') return false;
    return true;
}

function isSubstringHeadingMatch(cleanHeading, cleanTarget) {
    if (!cleanHeading) return false;
    return cleanHeading.includes(cleanTarget) ||
           (cleanTarget.length >= 4 && cleanHeading.length >= 4 && cleanTarget.includes(cleanHeading));
}

/**
 * Isi semua pertanyaan yang cocok pada halaman form
 */
async function fillAllQuestions(data) {
    document.querySelectorAll('[data-gform-filled]').forEach(el => el.removeAttribute('data-gform-filled'));

    const rawList = Array.isArray(data) 
        ? data 
        : Object.entries(data).map(([question, answer]) => ({ question, answer }));

    const items = [];
    for (const item of rawList) {
        const rawQuestion = (item.question || '').replace(/^[-*\d.)\s]+/, '').trim();
        const answerText = item.answer;
        if (answerText === undefined || answerText === null || String(answerText).trim() === '' || !rawQuestion) continue;

        const cleanTarget = normalizeText(rawQuestion);
        if (!cleanTarget) continue;

        items.push({
            cleanTarget,
            answerText: String(answerText).trim(),
            matchedTier: null
        });
    }

    if (items.length === 0) return;

    // Ambil baris spesifik kisi radiogroup
    const allRadiogroups = Array.from(document.querySelectorAll('[role="radiogroup"]'));
    const gridRows = allRadiogroups.filter(rg => {
        return rg.querySelectorAll('[role="radiogroup"]').length === 0 && rg.querySelectorAll('[role="radio"]').length > 0;
    });

    const allCards = getQuestionCards();

    const cardTiers = [
        {
            name: 'exact',
            matches: (card, cleanTarget) => {
                const cleanHeading = normalizeText(getQuestionHeading(card));
                return Boolean(cleanHeading && cleanHeading === cleanTarget);
            }
        },
        {
            name: 'substring',
            matches: (card, cleanTarget) => {
                const cleanHeading = normalizeText(getQuestionHeading(card));
                return isSubstringHeadingMatch(cleanHeading, cleanTarget);
            }
        },
        {
            name: 'fallback',
            matches: (card, cleanTarget) => {
                const cleanCardText = normalizeText(card.textContent);
                return Boolean(cleanCardText && cleanCardText.includes(cleanTarget));
            }
        }
    ];

    // Pass 1: Pencocokan 1-ke-1 sesuai tingkat prioritas (menghindari jawaban saling menimpa)
    for (const item of items) {
        if (item.matchedTier) continue;
        const matchedRow = gridRows.find(row =>
            row.getAttribute('data-gform-filled') !== 'true' && isGridRowMatch(row, item.cleanTarget)
        );
        if (matchedRow) {
            await fillGridRow(matchedRow, item.answerText);
            matchedRow.setAttribute('data-gform-filled', 'true');
            item.matchedTier = 'grid';
        }
    }

    for (const tier of cardTiers) {
        for (const item of items) {
            if (item.matchedTier) continue;
            const matchedCard = allCards.find(card =>
                isCardEligible(card) && tier.matches(card, item.cleanTarget)
            );
            if (matchedCard) {
                await fillComponent(matchedCard, item.answerText);
                matchedCard.setAttribute('data-gform-filled', 'true');
                item.matchedTier = tier.name;
            }
        }
    }

    // Pass 2: Isi pertanyaan/baris duplikat yang masih kosong (misal 2 pertanyaan "Email" dengan 1 data "Email")
    for (const row of gridRows) {
        if (row.getAttribute('data-gform-filled') === 'true') continue;
        const matchedItem = items.find(item => isGridRowMatch(row, item.cleanTarget));
        if (matchedItem) {
            await fillGridRow(row, matchedItem.answerText);
            row.setAttribute('data-gform-filled', 'true');
        }
    }

    for (const card of allCards) {
        if (!isCardEligible(card)) continue;

        let matchedItem = null;
        for (const tier of cardTiers) {
            matchedItem = items.find(item => {
                if (tier.name === 'substring' && (item.matchedTier === 'exact' || item.matchedTier === 'grid')) return false;
                if (tier.name === 'fallback' && item.matchedTier && item.matchedTier !== 'fallback') return false;
                return tier.matches(card, item.cleanTarget);
            });
            if (matchedItem) break;
        }

        if (matchedItem) {
            await fillComponent(card, matchedItem.answerText);
            card.setAttribute('data-gform-filled', 'true');
        }
    }
}

/**
 * Mengisi baris kisi (Multiple Choice Grid)
 */
async function fillGridRow(rowContainer, targetAnswer) {
    const radios = Array.from(rowContainer.querySelectorAll('[role="radio"]'));
    if (radios.length === 0) return;

    const targetVal = String(targetAnswer).trim();
    const cleanAnswer = normalizeText(targetVal);

    // Jawaban berupa angka skala
    if (!isNaN(targetVal)) {
        const num = parseInt(targetVal, 10);

        const byDataVal = radios.find(r => (r.getAttribute('data-value') || '').trim() === targetVal);
        if (byDataVal) {
            selectElement(byDataVal);
            return;
        }

        if (num >= 1 && num <= radios.length) {
            selectElement(radios[num - 1]);
            return;
        }
    }

    // Pencocokan teks opsi kisi
    for (const radio of radios) {
        const ariaLabel = normalizeText(radio.getAttribute('aria-label') || '');
        const dataVal = normalizeText(radio.getAttribute('data-value') || '');

        if (dataVal === cleanAnswer || ariaLabel.includes(cleanAnswer)) {
            selectElement(radio);
            return;
        }
    }
}

/**
 * Mengisi komponen input di dalam satu kartu pertanyaan
 */
async function fillComponent(container, answer) {
    if (answer === undefined || answer === null) return;
    const targetAnswer = String(answer).trim();
    if (!targetAnswer) return;

    const targetLower = targetAnswer.toLowerCase();
    const cleanAnswer = normalizeText(targetAnswer);

    // 1. RADIO BUTTONS (Pilihan Ganda & Skala Linier)
    const radios = Array.from(container.querySelectorAll('[role="radio"]'));
    if (radios.length > 0) {
        let matchedRadio = null;

        // A. Cek Skala Angka (Likert Scale)
        if (!isNaN(targetAnswer)) {
            matchedRadio = radios.find(r => {
                const dataVal = (r.getAttribute('data-value') || '').trim();
                const ariaLabel = (r.getAttribute('aria-label') || '').trim();
                return dataVal === targetAnswer || ariaLabel === targetAnswer || 
                       ariaLabel.startsWith(targetAnswer + ',') || ariaLabel.startsWith(targetAnswer + ' ');
            });

            if (!matchedRadio) {
                const num = parseInt(targetAnswer, 10);
                if (num >= 1 && num <= radios.length) {
                    matchedRadio = radios[num - 1];
                }
            }
        }

        // B. Pencocokan Teks Opsi (Fase 1: Exact Match)
        if (!matchedRadio) {
            matchedRadio = radios.find(radio => {
                const dataVal = (radio.getAttribute('data-value') || '').toLowerCase().trim();
                const ariaLabel = (radio.getAttribute('aria-label') || '').toLowerCase().trim();
                const parentRow = radio.closest('.docssharedWizToggleLabeledControl, .nWQGrd, label') || radio.parentElement;
                const labelText = (parentRow ? parentRow.textContent : '').toLowerCase().trim();

                const cleanData = normalizeText(dataVal);
                const cleanAria = normalizeText(ariaLabel);
                const cleanLabel = normalizeText(labelText);

                return dataVal === targetLower || ariaLabel === targetLower || labelText === targetLower ||
                       cleanData === cleanAnswer || cleanAria === cleanAnswer || cleanLabel === cleanAnswer;
            });
        }

        // Pencocokan Teks Opsi (Fase 2: Partial Match)
        if (!matchedRadio) {
            matchedRadio = radios.find(radio => {
                const dataVal = (radio.getAttribute('data-value') || '').toLowerCase().trim();
                const ariaLabel = (radio.getAttribute('aria-label') || '').toLowerCase().trim();
                const parentRow = radio.closest('.docssharedWizToggleLabeledControl, .nWQGrd, label') || radio.parentElement;
                const labelText = (parentRow ? parentRow.textContent : '').toLowerCase().trim();

                if (ariaLabel.includes('lainnya') || ariaLabel.includes('yang lain') || ariaLabel.includes('other') ||
                    labelText.includes('lainnya') || labelText.includes('yang lain') || labelText.includes('other')) {
                    return false;
                }

                const cleanData = normalizeText(dataVal);
                const cleanAria = normalizeText(ariaLabel);
                const cleanLabel = normalizeText(labelText);

                return (cleanData && (cleanData.includes(cleanAnswer) || cleanAnswer.includes(cleanData))) ||
                       (cleanAria && (cleanAria.includes(cleanAnswer) || cleanAnswer.includes(cleanAria))) ||
                       (cleanLabel && (cleanLabel.includes(cleanAnswer) || cleanAnswer.includes(cleanLabel)));
            });
        }

        if (matchedRadio) {
            selectElement(matchedRadio);
            return;
        }

        // C. Opsi "Lainnya" / "Other"
        const otherRadio = radios.find(r => {
            const aria = (r.getAttribute('aria-label') || '').toLowerCase();
            const data = (r.getAttribute('data-value') || '').toLowerCase();
            const parentRow = r.closest('.docssharedWizToggleLabeledControl, .nWQGrd, label') || r.parentElement;
            const txt = (parentRow ? parentRow.textContent : '').toLowerCase();

            return aria.includes('lainnya') || aria.includes('yang lain') || aria.includes('other') ||
                   data.includes('lainnya') || data.includes('yang lain') || data.includes('other') ||
                   txt.includes('lainnya') || txt.includes('yang lain') || txt.includes('other');
        });

        if (otherRadio) {
            selectElement(otherRadio);
            await delay(150);
            const otherInput = container.querySelector('.Hvn33, input[type="text"]');
            if (otherInput) {
                setNativeInputValue(otherInput, targetAnswer);
            }
        }
        return;
    }

    // 2. CHECKBOXES (Kotak Centang)
    const checkboxes = Array.from(container.querySelectorAll('[role="checkbox"]'));
    if (checkboxes.length > 0) {
        const answersList = targetAnswer.split(',').map(a => a.trim()).filter(Boolean);
        const matchedOptions = [];

        checkboxes.forEach(checkbox => {
            const dataVal = (checkbox.getAttribute('data-value') || '').toLowerCase().trim();
            const ariaLabel = (checkbox.getAttribute('aria-label') || '').toLowerCase().trim();
            const parentRow = checkbox.closest('.docssharedWizToggleLabeledControl, .nWQGrd, label') || checkbox.parentElement;
            const labelText = (parentRow ? parentRow.textContent : '').toLowerCase().trim();

            const isOther = ariaLabel.includes('lainnya') || ariaLabel.includes('yang lain') || ariaLabel.includes('other') ||
                            labelText.includes('lainnya') || labelText.includes('yang lain') || labelText.includes('other');
            if (isOther) return;

            const cleanData = normalizeText(dataVal);
            const cleanAria = normalizeText(ariaLabel);
            const cleanLabel = normalizeText(labelText);

            const shouldCheck = answersList.some(target => {
                const cleanTarget = normalizeText(target);
                const targetL = target.toLowerCase();
                return dataVal === targetL || ariaLabel === targetL || labelText === targetL ||
                       (cleanTarget && (cleanData === cleanTarget || cleanAria === cleanTarget || cleanLabel === cleanTarget ||
                                        cleanData.includes(cleanTarget) || cleanLabel.includes(cleanTarget)));
            });

            if (shouldCheck) {
                matchedOptions.push(checkbox);
            }

            const isCurrentlyChecked = checkbox.getAttribute('aria-checked') === 'true';
            if (shouldCheck !== isCurrentlyChecked) {
                selectElement(checkbox);
            }
        });

        // Tangani isian teks kustom pada opsi "Lainnya"
        const customAnswers = answersList.filter(ans => {
            const cleanAns = normalizeText(ans);
            return !matchedOptions.some(cb => {
                const text = (cb.getAttribute('aria-label') || cb.textContent || '').toLowerCase();
                return normalizeText(text).includes(cleanAns);
            });
        });

        if (customAnswers.length > 0) {
            const otherCheckbox = checkboxes.find(cb => {
                const aria = (cb.getAttribute('aria-label') || '').toLowerCase();
                const parentRow = cb.closest('.docssharedWizToggleLabeledControl, .nWQGrd, label') || cb.parentElement;
                const txt = (parentRow ? parentRow.textContent : '').toLowerCase();
                return aria.includes('lainnya') || aria.includes('yang lain') || aria.includes('other') ||
                       txt.includes('lainnya') || txt.includes('yang lain') || txt.includes('other');
            });

            if (otherCheckbox) {
                if (otherCheckbox.getAttribute('aria-checked') !== 'true') {
                    selectElement(otherCheckbox);
                }
                await delay(150);
                const otherInput = container.querySelector('.Hvn33, input[type="text"]');
                if (otherInput) {
                    setNativeInputValue(otherInput, customAnswers.join(', '));
                }
            }
        }
        return;
    }

    // 3. DROPDOWN (Menu Tarik-Turun)
    const dropdownTrigger = container.querySelector('[role="listbox"], [aria-haspopup="true"], .quantumWizMenuPaperselectOptionList');
    if (dropdownTrigger) {
        dropdownTrigger.focus();
        selectElement(dropdownTrigger);
        await delay(500);

        const options = Array.from(document.querySelectorAll('div[role="option"], .quantumWizMenuPaperselectOption, .exportSelectPopup div[role="option"]'));

        const targetOption = options.find(opt => {
            if (opt.offsetParent === null) return false;

            const optData = (opt.getAttribute('data-value') || '').toLowerCase().trim();
            const optText = (opt.textContent || '').toLowerCase().trim();

            if (!optText || optText === 'pilih' || optText === 'choose') return false;

            const cleanOpt = normalizeText(optText);

            if (optData === targetLower || optText === targetLower || cleanOpt === cleanAnswer) return true;

            return optData.includes(targetLower) || optText.includes(targetLower) ||
                   (cleanAnswer && cleanOpt.includes(cleanAnswer));
        });

        if (targetOption) {
            selectElement(targetOption);
            await delay(200);
        } else {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        }
        return;
    }

    // 4. DATE INPUT (Tanggal)
    const dateInput = container.querySelector('input[type="date"]');
    if (dateInput) {
        let formattedDate = targetAnswer;
        const parts = targetAnswer.split(/[-/]/);
        if (parts.length === 3) {
            if (parts[0].length === 4) {
                formattedDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            } else if (parts[2].length === 4) {
                formattedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
        }
        setNativeInputValue(dateInput, formattedDate);
        return;
    }

    // Input tanggal terpisah (Hari / Bulan / Tahun)
    const subDateInputs = Array.from(container.querySelectorAll('input[type="text"], input:not([type])')).filter(inp => {
        const label = (inp.getAttribute('aria-label') || '').toLowerCase();
        return label.includes('hari') || label.includes('bulan') || label.includes('tahun') ||
               label.includes('day') || label.includes('month') || label.includes('year');
    });

    if (subDateInputs.length >= 3) {
        const parts = targetAnswer.split(/[-/]/);
        if (parts.length === 3) {
            let day, month, year;
            if (parts[0].length === 4) {
                [year, month, day] = parts;
            } else {
                [day, month, year] = parts;
            }

            subDateInputs.forEach(inp => {
                const label = (inp.getAttribute('aria-label') || '').toLowerCase();
                let val = '';
                if (label.includes('hari') || label.includes('day')) val = day;
                else if (label.includes('bulan') || label.includes('month')) val = month;
                else if (label.includes('tahun') || label.includes('year')) val = year;

                if (val) {
                    setNativeInputValue(inp, val);
                }
            });
            return;
        }
    }

    // 5. INPUT TEXT, EMAIL, NUMBER, TEL, & TEXTAREA
    const inputs = container.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea');
    const standardInputs = Array.from(inputs).filter(inp => !inp.classList.contains('Hvn33') && inp.getAttribute('role') !== 'combobox');
    if (standardInputs.length > 0) {
        standardInputs.forEach(input => {
            setNativeInputValue(input, targetAnswer);
        });
        return;
    }
}

/**
 * Mencari dan menekan tombol navigasi formulir (Kirim / Berikutnya)
 */
function handleFormNavigation() {
    console.log("[Navigation] Mencari tombol navigasi...");

    const allButtons = Array.from(document.querySelectorAll('div[role="button"], span[role="button"], button'));
    let targetButton = null;
    let actionType = null;

    // 1. Cari Submit / Kirim
    for (const btn of allButtons) {
        if (btn.offsetParent === null) continue;
        const text = (btn.textContent || btn.innerText || '').toLowerCase().trim();
        if (text === "kirim" || text === "submit" || text.startsWith("kirim") || text.startsWith("submit")) {
            targetButton = btn;
            actionType = 'submit';
            break;
        }
    }

    // 2. Cari Berikutnya / Next
    if (!targetButton) {
        for (const btn of allButtons) {
            if (btn.offsetParent === null) continue;
            const text = (btn.textContent || btn.innerText || '').toLowerCase().trim();
            if (text === "berikutnya" || text === "next" || text.startsWith("berikutnya") || text.startsWith("next")) {
                targetButton = btn;
                actionType = 'next';
                break;
            }
        }
    }

    // 3. Fallback Selector
    if (!targetButton) {
        const navContainer = document.querySelector('.appsMaterialWewebAnimateFormbuttonNavButton, .uArJ5e[role="button"]');
        if (navContainer && navContainer.offsetParent !== null) {
            targetButton = navContainer;
            const txt = (navContainer.textContent || '').toLowerCase().trim();
            actionType = (txt.includes('kirim') || txt.includes('submit')) ? 'submit' : 'next';
        }
    }

    if (targetButton) {
        console.log(`[Navigation] Menekan tombol ${actionType}:`, targetButton.textContent.trim());
        selectElement(targetButton);
        return actionType;
    }

    return null;
}