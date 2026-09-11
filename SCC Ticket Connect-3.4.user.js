
// ==UserScript==
// @name         SCC Ticket Connect
// @namespace    http://tampermonkey.net/
// @version      3.4
// @description  Displays RME ticket links on disabled stations in SCC by reading Slack channels
// @match        https://staffingcommandcenter-na.aka.amazon.com/*/approved/*
// @match        https://staffingcommandcenter-na.aka.amazon.com/*/plan/*
// @updateURL    https://github.com/ntetesamuela/scc-ticket-connect/raw/refs/heads/main/SCC%20Ticket%20Connect-3.4.user.js
// @downloadURL  https://github.com/ntetesamuela/scc-ticket-connect/raw/refs/heads/main/SCC%20Ticket%20Connect-3.4.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      slack.com
// ==/UserScript==

(function () {
    'use strict';

    // ─── CONFIG ───────────────────────────────────────────────────
    const SLACK_BOT_TOKEN = 'xoxb-1226494846485-11996585843505-lXvCQ78dlo8hmgcjV92pYm5C';
    const RME_CHANNEL_ID = 'C0B98TLA6KA';
    const DISABLED_CHANNEL_ID = 'C0BV2EJAE91';
    const POLL_INTERVAL_MS = 60000;
    const MAX_MESSAGES = 500;
    const HISTORY_MAX_MESSAGES = 999;
    const TABLE_SELECTOR = 'table.rsp-table.table-holder.table-striped[data-cy="rsp-table"]';

    const RESOLVED_KEYWORDS = [
        'resolved', 'closed', 'completed', 'fixed',
        'cancelled', 'canceled', 'duplicate'
    ];

    // ─── STATE ────────────────────────────────────────────────────
    let ticketMap = {};
    let rmeTickets = {};
    let disabledTickets = {};
    let fetchesComplete = 0;
    let allRmeMessages = [];

    // ─── STYLES ───────────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
        /* ─── Inline badges (disabled stations) ─── */
        .scc-ticket-inline {
            display: inline-flex;
            align-items: center;
            gap: 0;
            vertical-align: middle;
            white-space: nowrap;
            margin: 0;
            padding: 0;
            line-height: 1;
        }
        .scc-edit-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: #ff9900;
            color: #111;
            font-size: 10px;
            padding: 0 3px;
            border-radius: 2px 0 0 2px;
            cursor: pointer;
            border: none;
            border-right: 1px solid rgba(0,0,0,0.15);
            font-family: 'Amazon Ember', Arial, sans-serif;
            line-height: 1;
            margin: 0;
        }
        .scc-edit-btn:hover { background: #e88800; }
        .scc-edit-btn.manual { background: #36c5f0; }
        .scc-edit-btn.manual:hover { background: #2ba8d0; }
        .scc-ticket-link {
            display: inline-flex;
            align-items: center;
            background: #ff9900;
            color: #111;
            font-size: 9px;
            font-weight: 600;
            padding: 0 4px;
            border-radius: 0 2px 2px 0;
            cursor: pointer;
            text-decoration: none;
            white-space: nowrap;
            font-family: 'Amazon Ember', Arial, sans-serif;
            line-height: 1;
            margin: 0;
        }
        .scc-ticket-link:hover { background: #e88800; color: #fff; }
        .scc-ticket-link.manual { background: #36c5f0; color: #111; }
        .scc-ticket-link.manual:hover { background: #2ba8d0; color: #fff; }
        .scc-no-ticket-inline {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            vertical-align: middle;
            white-space: nowrap;
            margin: 0;
            padding: 0;
            line-height: 1;
        }
        .scc-add-ticket-btn {
            display: inline-flex;
            align-items: center;
            background: #555;
            color: #fff;
            font-size: 9px;
            font-weight: 600;
            padding: 0 4px;
            border-radius: 2px;
            cursor: pointer;
            border: none;
            white-space: nowrap;
            font-family: 'Amazon Ember', Arial, sans-serif;
            line-height: 1;
            margin: 0;
        }
        .scc-add-ticket-btn:hover { background: #777; }
        .scc-history-btn {
            display: inline-flex;
            align-items: center;
            background: #3a3a5c;
            color: #fff;
            font-size: 9px;
            font-weight: 600;
            padding: 0 4px;
            border-radius: 2px;
            cursor: pointer;
            border: none;
            white-space: nowrap;
            font-family: 'Amazon Ember', Arial, sans-serif;
            line-height: 1;
            margin: 0;
        }
        .scc-history-btn:hover { background: #52527a; }

        /* ─── Sidebar ticket icon ─── */
        .scc-sidebar-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 16px;
            background: #ff9900;
            border-radius: 3px;
            cursor: pointer;
            font-size: 10px;
            line-height: 1;
            box-shadow: 0 1px 2px rgba(0,0,0,0.2);
            transition: background 0.15s;
            vertical-align: middle;
            margin: 0;
            padding: 0;
            border: none;
            flex-shrink: 0;
        }
        .scc-sidebar-icon:hover {
            background: #e88800;
        }
        .scc-sidebar-cell {
            padding: 0 2px !important;
            width: 20px !important;
            min-width: 20px !important;
            max-width: 20px !important;
            text-align: center !important;
            vertical-align: middle !important;
        }
        .scc-sidebar-header {
            padding: 0 2px !important;
            width: 20px !important;
            min-width: 20px !important;
            max-width: 20px !important;
        }

        /* ─── Modal ─── */
        .scc-modal-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .scc-modal {
            background: #fff;
            border-radius: 8px;
            padding: 20px;
            width: 340px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            font-family: 'Amazon Ember', Arial, sans-serif;
        }
        .scc-modal.wide {
            width: 480px;
        }
        .scc-modal h3 {
            margin: 0 0 14px 0;
            font-size: 15px;
            color: #111;
        }
        .scc-modal label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            color: #333;
            margin-bottom: 4px;
        }
        .scc-modal input {
            width: 100%;
            padding: 8px;
            margin-bottom: 12px;
            border: 1px solid #ccc;
            border-radius: 4px;
            font-size: 13px;
            box-sizing: border-box;
            font-family: 'Amazon Ember', Arial, sans-serif;
        }
        .scc-modal input:focus {
            outline: none;
            border-color: #ff9900;
        }
        .scc-modal .scc-modal-buttons {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
        }
        .scc-modal button {
            padding: 6px 14px;
            border-radius: 4px;
            border: none;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            font-family: 'Amazon Ember', Arial, sans-serif;
        }
        .scc-modal .scc-btn-save { background: #ff9900; color: #111; }
        .scc-modal .scc-btn-save:hover { background: #e88800; }
        .scc-modal .scc-btn-cancel { background: #eee; color: #333; }
        .scc-modal .scc-btn-cancel:hover { background: #ddd; }
        .scc-modal .scc-btn-remove { background: #d13212; color: #fff; }
        .scc-modal .scc-btn-remove:hover { background: #b02a0f; }
        .scc-modal .scc-error { color: #d13212; font-size: 11px; margin-bottom: 8px; }
        .scc-modal .scc-success { color: #1a8a1a; font-size: 11px; margin-bottom: 8px; }

        /* ─── History / Sidebar Modal List ─── */
        .scc-history-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        .scc-history-item {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 10px 0;
            border-bottom: 1px solid #eee;
        }
        .scc-history-item:last-child { border-bottom: none; }
        .scc-history-status { font-size: 14px; margin-top: 2px; }
        .scc-history-details { flex: 1; }
        .scc-history-ticket-link {
            font-size: 13px;
            font-weight: 600;
            color: #0073bb;
            text-decoration: none;
        }
        .scc-history-ticket-link:hover { text-decoration: underline; }
        .scc-history-title { font-size: 12px; color: #555; margin-top: 2px; }
        .scc-history-date { font-size: 11px; color: #999; margin-top: 2px; }
        .scc-history-empty {
            color: #999;
            font-size: 13px;
            text-align: center;
            padding: 20px 0;
        }
        .scc-history-loading {
            color: #666;
            font-size: 13px;
            text-align: center;
            padding: 20px 0;
        }
    `;
    document.head.appendChild(style);

    // ─── FORMAT TIMESTAMP ─────────────────────────────────────────
    function formatTimestamp(ts) {
        const date = new Date(parseFloat(ts) * 1000);
        return date.toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
        });
    }

    // ─── POST MANUAL TICKET TO SLACK ──────────────────────────────
    function postToSlack(stationNumber, ticketId, ticketUrl, description, callback) {
        const message = `Ticket <${ticketUrl}|${ticketId}>\nTitle: Station ${stationNumber} — ${description || 'Disabled'}\nRequester: SCC Ticket Connect`;

        GM_xmlhttpRequest({
            method: 'POST',
            url: 'https://slack.com/api/chat.postMessage',
            headers: {
                'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: JSON.stringify({ channel: DISABLED_CHANNEL_ID, text: message }),
            onload: function (response) {
                try {
                    const data = JSON.parse(response.responseText);
                    if (data.ok) { callback(true); }
                    else { callback(false, data.error); }
                } catch (e) { callback(false, 'Parse error'); }
            },
            onerror: function () { callback(false, 'Request failed'); }
        });
    }

    // ─── POST RESOLUTION TO SLACK ─────────────────────────────────
    function postResolutionToSlack(stationNumber, ticketId) {
        const message = `Ticket ${ticketId}\nTitle: Station ${stationNumber} — Resolved\nStatus: Resolved`;

        GM_xmlhttpRequest({
            method: 'POST',
            url: 'https://slack.com/api/chat.postMessage',
            headers: {
                'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: JSON.stringify({ channel: DISABLED_CHANNEL_ID, text: message }),
            onload: function () {},
            onerror: function () {}
        });
    }

    // ─── FETCH MESSAGES FROM A CHANNEL (PAGINATED) ────────────────
    function fetchChannelMessages(channelId, maxMessages, callback, cursor, accumulated) {
        cursor = cursor || null;
        accumulated = accumulated || [];
        const limit = Math.min(200, maxMessages - accumulated.length);
        let url = `https://slack.com/api/conversations.history?channel=${channelId}&limit=${limit}`;
        if (cursor) url += `&cursor=${cursor}`;

        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            headers: {
                'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            onload: function (response) {
                try {
                    const data = JSON.parse(response.responseText);
                    if (!data.ok) { callback([]); return; }

                    const allMessages = accumulated.concat(data.messages || []);
                    const nextCursor = data.response_metadata?.next_cursor;

                    if (nextCursor && allMessages.length < maxMessages) {
                        fetchChannelMessages(channelId, maxMessages, callback, nextCursor, allMessages);
                        return;
                    }
                    callback(allMessages);
                } catch (e) { callback([]); }
            },
            onerror: function () { callback([]); }
        });
    }

    // ─── CHECK IF TICKET IS RESOLVED ──────────────────────────────
    function isResolved(text) {
        const lower = text.toLowerCase();
        return RESOLVED_KEYWORDS.some(keyword => lower.includes(keyword));
    }

    // ─── EXTRACT ALL 4-DIGIT STATION NUMBERS ──────────────────────
    function extractStationNumbers(text) {
        const matches = text.match(/\b(\d{4})\b/g);
        return matches ? [...new Set(matches)] : [];
    }

    // ─── PARSE TICKET MESSAGE ─────────────────────────────────────
    function parseTicketMessage(msg) {
        const text = msg.text || '';
        const stationNumbers = extractStationNumbers(text);

        if (isResolved(text)) return { resolved: true, stationNumbers };

        const urlMatch = text.match(/<(https:\/\/t\.corp\.amazon\.com\/[^|>]+)\|?[^>]*>/);
        const url = urlMatch ? urlMatch[1] : null;

        const idMatch = text.match(/\b(V\d{5,})\b/);
        const ticketId = idMatch ? idMatch[1] : null;

        const titleMatch = text.match(/Title:\s*(.+)/i);
        const title = titleMatch ? titleMatch[1].trim() : '';

        return { url, ticketId, title, stationNumbers, resolved: false };
    }

    // ─── BUILD ACTIVE TICKET MAP (filters resolved) ───────────────
    function buildTicketMap(messages) {
        const map = {};
        const resolvedStations = new Set();

        messages.forEach(msg => {
            const parsed = parseTicketMessage(msg);
            if (!parsed.stationNumbers || parsed.stationNumbers.length === 0) return;

            if (parsed.resolved) {
                parsed.stationNumbers.forEach(sn => resolvedStations.add(sn));
                return;
            }

            parsed.stationNumbers.forEach(stationNum => {
                if (!map[stationNum] && !resolvedStations.has(stationNum)) {
                    if (parsed.url) {
                        map[stationNum] = { id: parsed.ticketId, title: parsed.title, url: parsed.url };
                    }
                }
            });
        });

        return map;
    }

    // ─── BUILD ALL-TICKETS MAP (open + closed, for sidebar) ───────
    function buildAllTicketsMap(messages) {
        const map = {};

        messages.forEach(msg => {
            const text = msg.text || '';
            const stationNumbers = extractStationNumbers(text);
            if (stationNumbers.length === 0) return;

            const urlMatch = text.match(/<(https:\/\/t\.corp\.amazon\.com\/[^|>]+)\|?[^>]*>/);
            const url = urlMatch ? urlMatch[1] : null;

            const idMatch = text.match(/\b(V\d{5,})\b/);
            const ticketId = idMatch ? idMatch[1] : null;
            if (!ticketId) return;

            const titleMatch = text.match(/Title:\s*(.+)/i);
            const title = titleMatch ? titleMatch[1].trim() : '';
            const resolved = isResolved(text);

            stationNumbers.forEach(sn => {
                if (!map[sn]) map[sn] = [];
                map[sn].push({
                    id: ticketId,
                    url: url || `https://t.corp.amazon.com/${ticketId}`,
                    title: title,
                    resolved: resolved,
                    timestamp: msg.ts
                });
            });
        });

        // Deduplicate per station
        Object.keys(map).forEach(sn => {
            const seen = new Set();
            map[sn] = map[sn].filter(item => {
                if (seen.has(item.id)) return false;
                seen.add(item.id);
                return true;
            });
        });

        return map;
    }

    // ─── SHOW SIDEBAR TICKET MODAL ────────────────────────────────
    function showSidebarModal(stationNumber, tickets) {
        const overlay = document.createElement('div');
        overlay.className = 'scc-modal-overlay';

        let listHtml = '<ul class="scc-history-list">';
        tickets.forEach(item => {
            const statusIcon = item.resolved ? '✅' : '🔧';
            const statusLabel = item.resolved ? 'Resolved' : 'Open';
            listHtml += `
                <li class="scc-history-item">
                    <span class="scc-history-status" title="${statusLabel}">${statusIcon}</span>
                    <div class="scc-history-details">
                        <a class="scc-history-ticket-link" href="${item.url}" target="_blank">${item.id}</a>
                        ${item.title ? `<div class="scc-history-title">${item.title}</div>` : ''}
                        <div class="scc-history-date">${formatTimestamp(item.timestamp)} · ${statusLabel}</div>
                    </div>
                </li>
            `;
        });
        listHtml += '</ul>';

        overlay.innerHTML = `
            <div class="scc-modal wide">
                <h3>🎫 Tickets — Station ${stationNumber}</h3>
                <div style="font-size:12px;color:#666;margin-bottom:10px;">${tickets.length} ticket${tickets.length > 1 ? 's' : ''} found</div>
                ${listHtml}
                <div class="scc-modal-buttons" style="margin-top:12px;">
                    <button class="scc-btn-cancel">Close</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        overlay.querySelector('.scc-btn-cancel').addEventListener('click', () => overlay.remove());
    }

    // ─── SHOW HISTORY MODAL (for 📋 button, fetches up to 999) ───
    function showHistoryModal(stationNumber) {
        const overlay = document.createElement('div');
        overlay.className = 'scc-modal-overlay';

        overlay.innerHTML = `
            <div class="scc-modal wide">
                <h3>Ticket History — Station ${stationNumber}</h3>
                <div class="scc-history-loading">Loading history from #hou6-rme-tickets...</div>
            </div>
        `;

        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        fetchChannelMessages(RME_CHANNEL_ID, HISTORY_MAX_MESSAGES, (messages) => {
            const modal = overlay.querySelector('.scc-modal');
            const allMap = buildAllTicketsMap(messages);
            const tickets = allMap[stationNumber] || [];

            if (tickets.length === 0) {
                modal.innerHTML = `
                    <h3>Ticket History — Station ${stationNumber}</h3>
                    <div class="scc-history-empty">No tickets found in the last ${HISTORY_MAX_MESSAGES} messages.</div>
                    <div class="scc-modal-buttons"><button class="scc-btn-cancel">Close</button></div>
                `;
            } else {
                let listHtml = '<ul class="scc-history-list">';
                tickets.forEach(item => {
                    const statusIcon = item.resolved ? '✅' : '🔧';
                    const statusLabel = item.resolved ? 'Resolved' : 'Open';
                    listHtml += `
                        <li class="scc-history-item">
                            <span class="scc-history-status" title="${statusLabel}">${statusIcon}</span>
                            <div class="scc-history-details">
                                <a class="scc-history-ticket-link" href="${item.url}" target="_blank">${item.id}</a>
                                ${item.title ? `<div class="scc-history-title">${item.title}</div>` : ''}
                                <div class="scc-history-date">${formatTimestamp(item.timestamp)} · ${statusLabel}</div>
                            </div>
                        </li>
                    `;
                });
                listHtml += '</ul>';

                modal.innerHTML = `
                    <h3>Ticket History — Station ${stationNumber}</h3>
                    <div style="font-size:12px;color:#666;margin-bottom:10px;">${tickets.length} ticket${tickets.length > 1 ? 's' : ''} found in last ${HISTORY_MAX_MESSAGES} messages</div>
                    ${listHtml}
                    <div class="scc-modal-buttons" style="margin-top:12px;"><button class="scc-btn-cancel">Close</button></div>
                `;
            }

            modal.querySelector('.scc-btn-cancel').addEventListener('click', () => overlay.remove());
        });
    }

    // ─── MODAL: ADD / EDIT TICKET ─────────────────────────────────
    function showTicketModal(stationNumber, existingTicket) {
        existingTicket = existingTicket || null;
        const overlay = document.createElement('div');
        overlay.className = 'scc-modal-overlay';

        const isEdit = !!existingTicket;
        const title = isEdit ? `Edit Ticket — Station ${stationNumber}` : `Add Ticket — Station ${stationNumber}`;

        overlay.innerHTML = `
            <div class="scc-modal">
                <h3>${title}</h3>
                <label>Ticket ID or URL</label>
                <input type="text" class="scc-input-ticket"
                    placeholder="e.g. V2489284895 or https://t.corp.amazon.com/V2489284895"
                    value="${existingTicket ? (existingTicket.url || existingTicket.id || '') : ''}" />
                <label>Description (optional)</label>
                <input type="text" class="scc-input-desc"
                    placeholder="e.g. SAS issue - conveyor jam"
                    value="${existingTicket ? (existingTicket.title || '') : ''}" />
                <div class="scc-error" style="display:none;"></div>
                <div class="scc-success" style="display:none;"></div>
                <div class="scc-modal-buttons">
                    ${isEdit ? '<button class="scc-btn-remove">Remove</button>' : ''}
                    <button class="scc-btn-cancel">Cancel</button>
                    <button class="scc-btn-save">${isEdit ? 'Update' : 'Save'}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const inputTicket = overlay.querySelector('.scc-input-ticket');
        const inputDesc = overlay.querySelector('.scc-input-desc');
        const errorEl = overlay.querySelector('.scc-error');
        const successEl = overlay.querySelector('.scc-success');
        const saveBtn = overlay.querySelector('.scc-btn-save');

        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        overlay.querySelector('.scc-btn-cancel').addEventListener('click', () => overlay.remove());

        if (isEdit) {
            overlay.querySelector('.scc-btn-remove').addEventListener('click', () => {
                postResolutionToSlack(stationNumber, existingTicket.id);
                overlay.remove();
                fetchAllChannels();
            });
        }

        saveBtn.addEventListener('click', () => {
            const raw = inputTicket.value.trim();
            const desc = inputDesc.value.trim();

            if (!raw) {
                errorEl.textContent = 'Please enter a ticket ID or URL.';
                errorEl.style.display = 'block';
                successEl.style.display = 'none';
                return;
            }

            let ticketId = null;
            let ticketUrl = null;

            const urlMatch = raw.match(/https:\/\/t\.corp\.amazon\.com\/(V\d+)/);
            const idMatch = raw.match(/^(V\d{5,})$/);

            if (urlMatch) {
                ticketId = urlMatch[1];
                ticketUrl = raw;
            } else if (idMatch) {
                ticketId = idMatch[1];
                ticketUrl = `https://t.corp.amazon.com/${ticketId}`;
            } else {
                errorEl.textContent = 'Enter a valid ticket ID e.g. V2489284895 or full URL.';
                errorEl.style.display = 'block';
                successEl.style.display = 'none';
                return;
            }

            saveBtn.disabled = true;
            saveBtn.textContent = 'Posting...';
            errorEl.style.display = 'none';

            postToSlack(stationNumber, ticketId, ticketUrl, desc, (success, error) => {
                if (success) {
                    successEl.textContent = 'Posted to #hou6-disabled-stations ✓';
                    successEl.style.display = 'block';
                    setTimeout(() => { overlay.remove(); fetchAllChannels(); }, 1000);
                } else {
                    errorEl.textContent = `Failed to post: ${error}. Try again.`;
                    errorEl.style.display = 'block';
                    saveBtn.disabled = false;
                    saveBtn.textContent = isEdit ? 'Update' : 'Save';
                }
            });
        });

        inputTicket.focus();
        if (isEdit) inputTicket.select();
    }

    // ─── FETCH BOTH CHANNELS AND MERGE ────────────────────────────
    function fetchAllChannels() {
        fetchesComplete = 0;

        fetchChannelMessages(RME_CHANNEL_ID, MAX_MESSAGES, (messages) => {
            allRmeMessages = messages;
            rmeTickets = buildTicketMap(messages);
            console.log('[SCC Ticket Connect] #hou6-rme-tickets:', Object.keys(rmeTickets).length, 'active');
            fetchesComplete++;
            if (fetchesComplete === 2) mergeAndApply();
        });

        fetchChannelMessages(DISABLED_CHANNEL_ID, MAX_MESSAGES, (messages) => {
            disabledTickets = buildTicketMap(messages);
            console.log('[SCC Ticket Connect] #hou6-disabled-stations:', Object.keys(disabledTickets).length, 'active');
            fetchesComplete++;
            if (fetchesComplete === 2) mergeAndApply();
        });
    }

    // ─── MERGE BOTH MAPS AND APPLY ────────────────────────────────
    function mergeAndApply() {
        ticketMap = Object.assign({}, rmeTickets, disabledTickets);
        console.log('[SCC Ticket Connect] Combined:', Object.keys(ticketMap).length, 'total active stations');
        applyBadges();
        applySidebarIcons();
    }

    // ─── APPLY INLINE BADGES TO DISABLED STATIONS ─────────────────
    function applyBadges() {
        document.querySelectorAll('.scc-ticket-inline, .scc-no-ticket-inline').forEach(el => el.remove());

        const disabledStations = document.querySelectorAll('[class*="station-disabled"]');

        disabledStations.forEach(station => {
            const stationText = station.textContent || station.innerText || '';
            const stationMatch = stationText.match(/\b(\d{4})\b/);
            if (!stationMatch) return;

            const stationNum = stationMatch[1];
            const isFromDisabledChannel = !!disabledTickets[stationNum];
            const ticket = ticketMap[stationNum];

            const cells = station.querySelectorAll('td');
            if (cells.length < 2) return;
            const roleCell = cells[1];

            if (ticket) {
                const wrapper = document.createElement('span');
                wrapper.className = 'scc-ticket-inline';

                const editBtn = document.createElement('button');
                editBtn.className = 'scc-edit-btn' + (isFromDisabledChannel ? ' manual' : '');
                editBtn.textContent = '✏️';
                editBtn.title = `Edit ticket for station ${stationNum}`;
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); e.preventDefault();
                    showTicketModal(stationNum, ticket);
                });

                const link = document.createElement('a');
                link.className = 'scc-ticket-link' + (isFromDisabledChannel ? ' manual' : '');
                link.href = ticket.url;
                link.target = '_blank';
                link.title = ticket.title || ticket.id;
                link.textContent = ticket.id;
                link.addEventListener('click', (e) => { e.stopPropagation(); });

                wrapper.appendChild(editBtn);
                wrapper.appendChild(link);
                roleCell.appendChild(wrapper);
            } else {
                const wrapper = document.createElement('span');
                wrapper.className = 'scc-no-ticket-inline';

                const addBtn = document.createElement('button');
                addBtn.className = 'scc-add-ticket-btn';
                addBtn.textContent = '+ Ticket';
                addBtn.title = `Add a ticket for station ${stationNum}`;
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showTicketModal(stationNum);
                });

                const historyBtn = document.createElement('button');
                historyBtn.className = 'scc-history-btn';
                historyBtn.textContent = '📋';
                historyBtn.title = `View ticket history for station ${stationNum}`;
                historyBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showHistoryModal(stationNum);
                });

                wrapper.appendChild(addBtn);
                wrapper.appendChild(historyBtn);
                roleCell.appendChild(wrapper);
            }
        });
    }

    // ─── APPLY SIDEBAR ICONS TO ALL MATCHING TABLES ───────────────
    function applySidebarIcons() {
        // Clean up old sidebar cells
        document.querySelectorAll('.scc-sidebar-cell, .scc-sidebar-header').forEach(el => el.remove());

        // Select ALL matching tables on the page
        const tables = document.querySelectorAll(TABLE_SELECTOR);
        if (tables.length === 0) {
            console.warn('[SCC Ticket Connect] No tables found:', TABLE_SELECTOR);
            return;
        }

        // Build all-tickets map from stored RME messages (open + closed)
        const allTicketsMap = buildAllTicketsMap(allRmeMessages);
        let totalIconCount = 0;

        tables.forEach((table, tableIndex) => {
            const allRows = table.querySelectorAll('tr');
            let iconCount = 0;

            allRows.forEach(row => {
                // Header row — add an empty header cell
                const isHeader = row.querySelector('th');
                if (isHeader) {
                    const th = document.createElement('th');
                    th.className = 'scc-sidebar-header';
                    row.insertBefore(th, row.firstChild);
                    return;
                }

                // Data row — extract station number
                const rowText = row.textContent || row.innerText || '';
                const stationMatch = rowText.match(/\b(\d{4})\b/);

                const td = document.createElement('td');
                td.className = 'scc-sidebar-cell';

                if (stationMatch) {
                    const stationNum = stationMatch[1];
                    const tickets = allTicketsMap[stationNum];

                    if (tickets && tickets.length > 0) {
                        const icon = document.createElement('button');
                        icon.className = 'scc-sidebar-icon';
                        icon.textContent = '🎫';
                        icon.title = 'Ticket exists for this station';
                        icon.addEventListener('click', (e) => {
                            e.stopPropagation();
                            showSidebarModal(stationNum, tickets);
                        });
                        td.appendChild(icon);
                        iconCount++;
                    }
                }

                row.insertBefore(td, row.firstChild);
            });

            totalIconCount += iconCount;
            console.log(`[SCC Ticket Connect] Table ${tableIndex + 1}: ${iconCount} station icons placed`);
        });

        console.log(`[SCC Ticket Connect] Sidebar total: ${totalIconCount} icons across ${tables.length} table(s)`);
    }

    // ─── OBSERVE DOM FOR DYNAMIC CONTENT ──────────────────────────
    function startObserver() {
        const targetNode = document.querySelector('[class*="station"]')?.closest('[class*="content"], [class*="main"], [role="main"]') || document.body;

        const observer = new MutationObserver((mutations) => {
            let hasRelevantChange = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1 && (
                            node.matches?.('[class*="station"]') ||
                            node.querySelector?.('[class*="station"]')
                        )) {
                            hasRelevantChange = true;
                            break;
                        }
                    }
                }
                if (hasRelevantChange) break;
            }
            if (hasRelevantChange) {
                applyBadges();
                applySidebarIcons();
            }
        });

        observer.observe(targetNode, { childList: true, subtree: true });
    }

    // ─── INIT ─────────────────────────────────────────────────────
    console.log('[SCC Ticket Connect] Starting v3.4...');
    fetchAllChannels();
    startObserver();

    setInterval(fetchAllChannels, POLL_INTERVAL_MS);

})();

