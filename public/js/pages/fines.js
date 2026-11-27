(function () {

    "use strict";


    /* =========================================================
       PAGE STATE
       ========================================================= */

    const app =
        
        {

            data:
                [],

            searchQuery:
                "",

            clockTimer:
                null,

            loading:
                false

        };


    window.__FIB_MDT_FINES_PAGE__ = app;
    const mountedPage = document.getElementById("finesPage");


    /* =========================================================
       SESSION TOKEN
       ========================================================= */

    function getSessionToken() {

        if (
            typeof sessionToken !==
                "undefined" &&
            sessionToken
        ) {

            return String(
                sessionToken
            );

        }


        if (
            typeof getSystemSessionToken ===
                "function"
        ) {

            const token =
                getSystemSessionToken();


            if (token) {

                return String(
                    token
                );

            }

        }


        if (
            typeof window.currentSessionToken !==
                "undefined" &&
            window.currentSessionToken
        ) {

            return String(
                window.currentSessionToken
            );

        }


        try {

            return (
                sessionStorage.getItem(
                    "fib_mdt_session"
                ) ||

                sessionStorage.getItem(
                    "lspd_mdt_session"
                ) ||

                ""
            );

        } catch (error) {

            return "";

        }

    }


    /* =========================================================
       TEXT NORMALIZATION
       ========================================================= */

    function normalizeSearchText(
        value
    ) {

        return String(
            value ?? ""
        )

            .normalize(
                "NFD"
            )

            .replace(
                /[\u0300-\u036f]/g,
                ""
            )

            .toLowerCase()

            .replace(
                /\s+/g,
                " "
            )

            .trim();

    }


    /* =========================================================
       LAW BOOK NORMALIZATION
       ========================================================= */

    function normalizeLawBook(
        value
    ) {

        let lawBook =
            String(
                value ?? ""
            )
                .trim()
                .replace(
                    /\s+/g,
                    " "
                );


        if (!lawBook) {

            return "";

        }


        lawBook =
            lawBook

                .replace(
                    /\s*[-–—:]\s*(Delikt|Delikte|Straftat|Straftaten|Tatbestand|Tatbestände)$/i,
                    ""
                )

                .replace(
                    /\s+(Delikt|Delikte|Straftat|Straftaten|Tatbestand|Tatbestände)$/i,
                    ""
                )

                .trim();


        return lawBook;

    }


    /* =========================================================
       CATEGORY ROW
       ========================================================= */

    function isCategoryRow(
        fine
    ) {

        const paragraph =
            String(
                fine?.paragraph || ""
            ).trim();


        const offense =
            String(
                fine?.offense || ""
            ).trim();


        const money =
            String(
                fine?.fine || ""
            ).trim();


        const wanteds =
            String(
                fine?.wanteds || ""
            ).trim();


        return (
            paragraph !== "" &&
            offense === "" &&
            money === "" &&
            wanteds === ""
        );

    }


    /* =========================================================
       DATA PREPARATION
       ========================================================= */

    function prepareFinesData(
        rawData
    ) {

        let currentLawBook =
            "";

        let currentCategory =
            "";


        const prepared =
            [];


        rawData.forEach(
            function (
                fine
            ) {

                const rawLawBook =
                    String(
                        fine?.lawBook || ""
                    ).trim();


                const normalizedLawBook =
                    normalizeLawBook(
                        rawLawBook
                    );


                const description =
                    String(
                        fine?.paragraph || ""
                    )

                        .trim()

                        .replace(
                            /\s+/g,
                            " "
                        );


                if (
                    normalizedLawBook &&
                    normalizedLawBook !==
                        currentLawBook
                ) {

                    currentLawBook =
                        normalizedLawBook;

                    currentCategory =
                        "";

                }


                if (
                    isCategoryRow(
                        fine
                    )
                ) {

                    currentCategory =
                        description;

                    return;

                }


                const lawBook =
                    currentLawBook ||
                    normalizedLawBook ||
                    "Ohne Gesetzbuch";


                const category =
                    currentCategory;


                const searchValues = [

                    fine?.lawBook,
                    lawBook,
                    category,
                    fine?.paragraph,
                    fine?.offense,
                    fine?.fine,
                    fine?.wanteds,
                    fine?.info,
                    fine?.handoverFib,
                    fine?.handoverSta

                ];


                const searchText =
                    normalizeSearchText(

                        searchValues

                            .filter(
                                function (
                                    value
                                ) {

                                    return (
                                        String(
                                            value ?? ""
                                        ).trim() !== ""
                                    );

                                }
                            )

                            .join(" ")

                    );


                prepared.push({

                    lawBook:
                        String(
                            fine?.lawBook || ""
                        ).trim(),

                    _lawBook:
                        lawBook,

                    _category:
                        category,

                    _searchText:
                        searchText,

                    paragraph:
                        String(
                            fine?.paragraph || ""
                        ).trim(),

                    offense:
                        String(
                            fine?.offense || ""
                        ).trim(),

                    fine:
                        String(
                            fine?.fine || ""
                        ).trim(),

                    wanteds:
                        String(
                            fine?.wanteds || ""
                        ).trim(),

                    info:
                        String(
                            fine?.info || ""
                        ).trim(),

                    handoverFib:
                        String(
                            fine?.handoverFib || ""
                        ).trim(),

                    handoverSta:
                        String(
                            fine?.handoverSta || ""
                        ).trim()

                });

            }
        );


        return prepared;

    }


    /* =========================================================
       CENTRAL CACHE
       ========================================================= */

    function getCachedFines() {

        if (
            !window.fibCache ||
            !window.fibCache.fines
        ) {

            return null;

        }


        const cached =
            window.fibCache.fines.data;


        if (
            !Array.isArray(
                cached
            ) ||
            !cached.length
        ) {

            return null;

        }


        return cached;

    }


    /* =========================================================
       LOAD
       ========================================================= */

    function loadFines(
        forceRefresh
    ) {

        const content =
            document.getElementById(
                "finesContent"
            );


        if (!content) {

            return;

        }


        if (
            !forceRefresh
        ) {

            const cached =
                getCachedFines();


            if (
                cached
            ) {

                app.data =
                    cached;


                bindFinesEvents();

                renderFines();

                return;

            }

        }


        if (
            app.loading
        ) {

            return;

        }


        app.loading =
            true;


        setRefreshLoading(
            true
        );


        content.innerHTML = `

            <div class="fines-state">

                <span>
                    Bußgeldkatalog wird geladen …
                </span>

            </div>

        `;


        if (
            typeof CloudApi === "undefined" || !CloudApi.run
        ) {

            app.loading =
                false;


            setRefreshLoading(
                false
            );


            content.innerHTML = `

                <div class="fines-state error">

                    Der Bußgeldkatalog konnte nicht geladen werden.

                </div>

            `;

            return;

        }


        const token =
            getSessionToken();


        if (!token) {

            app.loading =
                false;


            setRefreshLoading(
                false
            );


            content.innerHTML = `

                <div class="fines-state error">

                    Keine aktive Sitzung.

                </div>

            `;

            return;

        }


        CloudApi.run

            .withSuccessHandler(
                function (
                    data
                ) {

                    if (!mountedPage?.isConnected) return;
                    const raw =
                        Array.isArray(
                            data
                        )
                            ? data
                            : [];


                    app.data =
                        prepareFinesData(
                            raw
                        );


                    if (
                        window.fibCache &&
                        window.fibCache.fines
                    ) {

                        window.fibCache.fines.data =
                            app.data;

                    }


                    app.loading =
                        false;


                    setRefreshLoading(
                        false
                    );


                    bindFinesEvents();

                    renderFines();

                }
            )

            .withFailureHandler(
                function (
                    error
                ) {

                    if (!mountedPage?.isConnected) return;
                    console.error(
                        "FINES:",
                        error
                    );


                    app.loading =
                        false;


                    setRefreshLoading(
                        false
                    );


                    content.innerHTML = `

                        <div class="fines-state error">

                            ${
                                escapeFinesHtml(
                                    error?.message ||
                                    "Der Bußgeldkatalog konnte nicht geladen werden."
                                )
                            }

                        </div>

                    `;

                }
            )

            .getFines(
                token
            );

    }


    /* =========================================================
       SEARCH
       ========================================================= */

    function getFilteredFines() {

        const query =
            normalizeSearchText(
                app.searchQuery
            );


        if (!query) {

            return app.data;

        }


        const terms =
            query
                .split(/\s+/)
                .filter(
                    function (
                        term
                    ) {

                        return term !== "";

                    }
                );


        return app.data.filter(
            function (
                fine
            ) {

                const searchText =
                    fine?._searchText ||
                    "";


                return terms.every(
                    function (
                        term
                    ) {

                        return searchText.includes(
                            term
                        );

                    }
                );

            }
        );

    }


    function updateSearchCount(
        count
    ) {

        const counter =
            document.getElementById(
                "finesSearchCount"
            );


        if (!counter) {

            return;

        }


        counter.textContent =
            count +
            (
                app.searchQuery.trim()
                    ? count === 1
                        ? " Treffer"
                        : " Treffer"

                    : count === 1
                        ? " Eintrag"
                        : " Einträge"
            );

    }


    /* =========================================================
       GROUP BY LAW BOOK
       ========================================================= */

    function groupFinesByLawBook(
        fines
    ) {

        const groups =
            [];


        fines.forEach(
            function (
                fine
            ) {

                const lawBook =
                    fine?._lawBook ||
                    "Ohne Gesetzbuch";


                let group =
                    groups.find(
                        function (
                            entry
                        ) {

                            return (
                                entry.lawBook ===
                                lawBook
                            );

                        }
                    );


                if (!group) {

                    group = {

                        lawBook:
                            lawBook,

                        rows:
                            []

                    };


                    groups.push(
                        group
                    );

                }


                group.rows.push(
                    fine
                );

            }
        );


        return groups;

    }


    /* =========================================================
       GROUP BY CATEGORY
       ========================================================= */

    function groupFinesByCategory(
        rows
    ) {

        const categories =
            [];


        rows.forEach(
            function (
                fine
            ) {

                const title =
                    String(
                        fine?._category || ""
                    ).trim();


                const key =
                    title ||
                    "__NO_CATEGORY__";


                let category =
                    categories.find(
                        function (
                            entry
                        ) {

                            return (
                                entry.key ===
                                key
                            );

                        }
                    );


                if (!category) {

                    category = {

                        key:
                            key,

                        title:
                            title,

                        rows:
                            []

                    };


                    categories.push(
                        category
                    );

                }


                category.rows.push(
                    fine
                );

            }
        );


        return categories;

    }


    /* =========================================================
       RENDER
       ========================================================= */

    function renderFines() {

        const content =
            document.getElementById(
                "finesContent"
            );


        if (!content) {

            return;

        }


        const filtered =
            getFilteredFines();


        updateSearchCount(
            filtered.length
        );


        if (
            !filtered.length
        ) {

            content.innerHTML = `

                <div class="fines-state">

                    ${
                        app.searchQuery.trim()

                            ? `
                                Keine Einträge für
                                „${escapeFinesHtml(
                                    app.searchQuery
                                )}“
                                gefunden.
                            `

                            : "Keine Einträge vorhanden."
                    }

                </div>

            `;

            return;

        }


        const groups =
            groupFinesByLawBook(
                filtered
            );


        content.innerHTML =
            groups

                .map(
                    function (
                        group
                    ) {

                        return renderFinesLawBook(
                            group
                        );

                    }
                )

                .join("");

    }


    /* =========================================================
       LAW BOOK
       ========================================================= */

    function renderFinesLawBook(
        group
    ) {

        const categories =
            groupFinesByCategory(
                group.rows
            );


        const totalEntries =
            group.rows.length;


        return `

            <section class="fines-lawbook">

                <div class="fines-lawbook-header">

                    <div class="fines-lawbook-header-left">

                        <div class="fines-lawbook-marker"></div>

                        <div class="fines-lawbook-name">

                            ${escapeFinesHtml(
                                group.lawBook
                            )}

                        </div>

                    </div>


                    <div class="fines-lawbook-count">

                        ${totalEntries}

                        ${
                            totalEntries === 1
                                ? "Tatbestand"
                                : "Tatbestände"
                        }

                    </div>

                </div>


                <div class="fines-lawbook-table">

                    <div class="fines-table-wrapper">

                        <table class="fines-table">

                            <colgroup>

                                <col class="fines-table-col-paragraph">
                                <col class="fines-table-col-offense">
                                <col class="fines-table-col-fine">
                                <col class="fines-table-col-wanteds">
                                <col class="fines-table-col-info">
                                <col class="fines-table-col-handover">
                                <col class="fines-table-col-handover">
                                <col class="fines-table-col-finished">

                            </colgroup>


                            <thead>

                                <tr>

                                    <th class="fines-col-paragraph">
                                        Paragraph
                                    </th>

                                    <th class="fines-col-offense">
                                        Vergehen
                                    </th>

                                    <th class="fines-col-fine center">
                                        Geldstrafe
                                    </th>

                                    <th class="fines-col-wanteds center">
                                        Wanteds
                                    </th>

                                    <th class="fines-col-info">
                                        Info
                                    </th>

                                    <th class="fines-col-handover center">
                                        FIB
                                    </th>

                                    <th class="fines-col-handover center">
                                        StA
                                    </th>
                                    <th class="fines-col-finished center">Aktion</th>

                                </tr>

                            </thead>


                            <tbody>

                                ${
                                    categories

                                        .map(
                                            function (
                                                category
                                            ) {

                                                return renderFinesCategory(
                                                    category
                                                );

                                            }
                                        )

                                        .join("")
                                }

                            </tbody>

                        </table>

                    </div>

                </div>

            </section>

        `;

    }


    /* =========================================================
       CATEGORY
       ========================================================= */

    function renderFinesCategory(
        category
    ) {

        const rows =
            category.rows;


        if (!rows.length) {

            return "";

        }


        const categoryHeader =
            category.title

                ? `

                    <tr class="fines-category-row">

                        <td colspan="8">

                            ${escapeFinesHtml(
                                category.title
                            )}

                        </td>

                    </tr>

                `

                : "";


        return `

            ${categoryHeader}

            ${
                rows

                    .map(
                        function (
                            fine
                        ) {

                            return renderFineRow(
                                fine
                            );

                        }
                    )

                    .join("")
            }

        `;

    }


    /* =========================================================
       ROW
       ========================================================= */

    function renderFineRow(
        fine
    ) {

        const paragraph =
            String(
                fine?.paragraph || ""
            ).trim();


        const offense =
            String(
                fine?.offense || ""
            ).trim();


        const money =
            String(
                fine?.fine || ""
            ).trim();


        const wanteds =
            String(
                fine?.wanteds || ""
            ).trim();


        const info =
            String(
                fine?.info || ""
            ).trim();


        const fib =
            normalizeFinesFlag(
                fine?.handoverFib
            );


        const sta =
            normalizeFinesFlag(
                fine?.handoverSta
            );


        const fineJson =
            encodeURIComponent(
                JSON.stringify({

                    lawBook:
                        fine?._lawBook ||
                        fine?.lawBook ||
                        "",

                    paragraph:
                        paragraph,

                    offense:
                        offense

                })
            );


        return `

            <tr class="fines-data-row">

                <td class="fines-col-paragraph">

                    ${escapeFinesHtml(
                        paragraph ||
                        "—"
                    )}

                </td>


                <td class="fines-col-offense">

                    ${escapeFinesHtml(
                        offense ||
                        "—"
                    )}

                </td>


                <td class="fines-col-fine">

                    <span class="fines-money">

                        ${escapeFinesHtml(
                            money ||
                            "—"
                        )}

                    </span>

                </td>


                <td class="fines-col-wanteds">

                    <span class="fines-wanted">

                        ${escapeFinesHtml(
                            wanteds ||
                            "—"
                        )}

                    </span>

                </td>


                <td class="fines-col-info">

                    ${
                        info

                            ? `

                                <span class="fines-info">

                                    ${escapeFinesHtml(
                                        info
                                    )}

                                </span>

                            `

                            : `

                                <span class="fines-info empty">
                                    —
                                </span>

                            `
                    }

                </td>


                <td class="fines-col-handover">

                    ${renderFinesHandover(
                        fib
                    )}

                </td>


                <td class="fines-col-handover">

                    ${renderFinesHandover(
                        sta
                    )}

                </td>

            


                <td class="fines-col-finished">

                    <button
                        type="button"
                        class="fines-copy-button"
                        data-fine="${fineJson}"
                        title="Tatbestand kopieren"
                        aria-label="Tatbestand kopieren"
                    >

                        <span aria-hidden="true">⧉</span> <span>Kopieren</span>

                    </button>

                </td>
            </tr>

        `;

    }


    /* =========================================================
       HANDOVER
       ========================================================= */

    function normalizeFinesFlag(
        value
    ) {

        const normalized =
            String(
                value ?? ""
            )
                .trim()
                .toLowerCase();


        if (
            normalized === "" ||
            normalized === "-" ||
            normalized === "nein" ||
            normalized === "no" ||
            normalized === "false" ||
            normalized === "0"
        ) {

            return false;

        }


        return true;

    }


    function renderFinesHandover(
        active
    ) {

        if (active) {

            return `

                <span
                    class="fines-handover yes"
                    title="Übergabe erforderlich"
                    aria-label="Übergabe erforderlich"
                >
                    ✓
                </span>

            `;

        }


        return `

            <span
                class="fines-handover no"
                title="Keine Übergabe"
                aria-label="Keine Übergabe"
            >
                —
            </span>

        `;

    }


    /* =========================================================
       COPY
       ========================================================= */

    function copyFinesEntry(
        button
    ) {

        if (!button) {

            return;

        }


        const encoded =
            button.dataset.fine;


        if (!encoded) {

            return;

        }


        let fine;


        try {

            fine =
                JSON.parse(
                    decodeURIComponent(
                        encoded
                    )
                );

        } catch (error) {

            console.error(
                "FINES Copy:",
                error
            );

            return;

        }


        let paragraph =
            String(
                fine?.paragraph || ""
            ).trim();


        if (paragraph) {

            paragraph =
                paragraph

                    .replace(
                        /^§\s*/,
                        ""
                    )

                    .trim();


            paragraph =
                `§ ${paragraph}`;

        }


        const lawBook =
            normalizeLawBook(
                fine?.lawBook
            );


        const offense =
            String(
                fine?.offense || ""
            ).trim();


        const now =
            new Date();


        const day =
            String(
                now.getDate()
            ).padStart(
                2,
                "0"
            );


        const month =
            String(
                now.getMonth() + 1
            ).padStart(
                2,
                "0"
            );


        const year =
            String(
                now.getFullYear()
            ).slice(-2);


        const date =
            `${day}.${month}.${year}`;


        const hours =
            String(
                now.getHours()
            ).padStart(
                2,
                "0"
            );


        const minutes =
            String(
                now.getMinutes()
            ).padStart(
                2,
                "0"
            );


        const time =
            `${hours}:${minutes}`;


        const text =
            [

                paragraph,
                offense,
                date,
                `- ${time}`

            ]

                .filter(
                    function (
                        value
                    ) {

                        return (
                            String(
                                value || ""
                            ).trim() !== ""
                        );

                    }
                )

                .join(" ");


        openFinesCopyModal(
            text,
            button
        );

    }


    function openFinesCopyModal(text, sourceButton) {
        const modal = window.FIB_MDT_MODAL;
        if (!modal) return;
        const body = document.createElement("div");
        body.className = "fib-fines-copy-extra v51-copy";
        body.innerHTML = `
            <div class="v51-copy-context"><span>Ausgewählter Tatbestand</span><strong id="fibFinesCopyBase"></strong></div>
            <div class="v51-copy-fields">
              <div><label for="fibFinesCopyExtra">Zusatz in Klammern (optional)</label><input id="fibFinesCopyExtra" type="text" maxlength="120" placeholder="z. B. StA n.V." autocomplete="off" spellcheck="false"><small>Wird in Klammern an den Text angehängt.</small></div>
              <div><label for="fibFinesCopySuffix">Zusatz danach (optional)</label><input id="fibFinesCopySuffix" type="text" maxlength="40" placeholder="z. B. 1/2 oder 2/2" autocomplete="off" spellcheck="false"><small>Wird nach dem Klammerzusatz angefügt.</small></div>
            </div>
            <div class="v51-copy-result"><label for="fibFinesCopyPreview">Fertiger Kopiertext</label><textarea id="fibFinesCopyPreview" readonly rows="3" spellcheck="false"></textarea><small>Dieser Text wird unverändert in die Zwischenablage übernommen.</small></div>
            <div id="fibFinesCopyFeedback" role="status" aria-live="polite"></div>`;
        const input = body.querySelector("#fibFinesCopyExtra"), suffix = body.querySelector("#fibFinesCopySuffix"), preview = body.querySelector("#fibFinesCopyPreview"), feedback = body.querySelector("#fibFinesCopyFeedback");
        body.querySelector("#fibFinesCopyBase").textContent = text;
        const render = () => { preview.value = text + (input.value.trim() ? ` (${input.value.trim()})` : "") + (suffix.value.trim() ? ` ${suffix.value.trim()}` : ""); feedback.textContent = ""; };
        input.addEventListener("input", render); suffix.addEventListener("input", render); render();
        modal.open({title:"Tatbestand kopieren",subtitle:"Dokumentation · Zusätze und Vorschau",body,cancelText:"Abbrechen",saveVisible:true,saveText:"In Zwischenablage kopieren",onSave:async button=>{
            button.disabled=true; const value=preview.value;
            try {
                let copied=false;
                if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(value);copied=true;}catch(_){}}
                if(!copied){preview.focus();preview.select();try{copied=document.execCommand("copy")===true;}catch(_){}}
                if(!copied){feedback.textContent="Automatisches Kopieren nicht möglich. Der Text ist markiert – bitte Strg+C verwenden.";return;}
                showFinesCopied(sourceButton);if(body.isConnected)modal.close();
            }finally{if(body.isConnected)button.disabled=false;}
        }});
    }

    function showFinesCopied(
        button
    ) {

        if (!button) {

            return;

        }


        const original =
            button.innerHTML;


        button.classList.add(
            "copied"
        );


        button.innerHTML = `

            <span class="fines-copy-icon">
                ✓
            </span>

        `;


        setTimeout(
            function () {

                button.classList.remove(
                    "copied"
                );


                button.innerHTML =
                    original;

            },
            1300
        );

    }


    /* =========================================================
       CLOCK
       ========================================================= */

    function updateFinesClock() {

        const clock =
            document.getElementById(
                "finesClock"
            );


        if (!clock) {

            return;

        }


        const now =
            new Date();


        const hours =
            String(
                now.getHours()
            ).padStart(
                2,
                "0"
            );


        const minutes =
            String(
                now.getMinutes()
            ).padStart(
                2,
                "0"
            );


        clock.innerHTML = `

            <strong>
                ${hours}:${minutes}
            </strong>

        `;

    }


    function scheduleFinesClock() {
        if (app.clockTimer) clearInterval(app.clockTimer);
        app.clockTimer=window.__fibPageLifecycle.interval(updateFinesClock,15000);
    }

    /* =========================================================
       REFRESH
       ========================================================= */

    function setRefreshLoading(
        loading
    ) {

        const button =
            document.getElementById(
                "finesRefreshButton"
            );


        if (!button) {

            return;

        }


        button.classList.toggle(
            "loading",
            !!loading
        );


        button.disabled=!!loading;
        button.textContent=loading?"Lädt …":"Aktualisieren";

    }


    function refreshFines() {

        window.FIBMDTCache?.refresh("getFines");

        if (
            window.fibCache &&
            window.fibCache.fines
        ) {

            window.fibCache.fines.data =
                null;

        }


        loadFines(
            true
        );

    }


    /* =========================================================
       EVENTS
       ========================================================= */

    function bindFinesEvents() {

        const searchInput =
            document.getElementById(
                "finesSearchInput"
            );


        if (
            searchInput &&
            !searchInput.dataset.finesBound
        ) {

            searchInput.dataset.finesBound =
                "1";


            searchInput.value =
                app.searchQuery;


            searchInput.addEventListener(
                "input",
                function () {

                    app.searchQuery =
                        searchInput.value;


                    renderFines();

                }
            );

        }


        const clearButton =
            document.getElementById(
                "finesSearchClear"
            );


        if (
            clearButton &&
            !clearButton.dataset.finesBound
        ) {

            clearButton.dataset.finesBound =
                "1";


            clearButton.addEventListener(
                "click",
                function () {

                    app.searchQuery =
                        "";


                    if (
                        searchInput
                    ) {

                        searchInput.value =
                            "";

                        searchInput.focus();

                    }


                    renderFines();

                }
            );

        }


        const refreshButton =
            document.getElementById(
                "finesRefreshButton"
            );


        if (
            refreshButton &&
            !refreshButton.dataset.finesBound
        ) {

            refreshButton.dataset.finesBound =
                "1";


            refreshButton.addEventListener(
                "click",
                function () {

                    refreshFines();

                }
            );

        }


        const content =
            document.getElementById(
                "finesContent"
            );


        if (
            content &&
            !content.dataset.finesBound
        ) {

            content.dataset.finesBound =
                "1";


            content.addEventListener(
                "click",
                function (
                    event
                ) {

                    const button =
                        event.target.closest(
                            ".fines-copy-button"
                        );


                    if (!button) {

                        return;

                    }


                    copyFinesEntry(
                        button
                    );

                }
            );

        }

    }


    /* =========================================================
       ESCAPE
       ========================================================= */

    function escapeFinesHtml(
        value
    ) {

        return String(
            value ?? ""
        )

            .replace(
                /&/g,
                "&amp;"
            )

            .replace(
                /</g,
                "&lt;"
            )

            .replace(
                />/g,
                "&gt;"
            )

            .replace(
                /"/g,
                "&quot;"
            )

            .replace(
                /'/g,
                "&#039;"
            );

    }


    /* =========================================================
       INITIALIZATION
       ========================================================= */

    function initFinesPage() {

        const page =
            document.getElementById(
                "finesPage"
            );


        if (!page) {

            return;

        }


        updateFinesClock();

        scheduleFinesClock();

        bindFinesEvents();


        const cached =
            getCachedFines();


        if (cached) {

            app.data =
                cached;


            renderFines();

            return;

        }


        loadFines(
            false
        );

    }


    /* =========================================================
       DYNAMIC PAGE INITIALIZATION
       ========================================================= */

    window.__fibPageLifecycle.timeout(
        function () {

            if(mountedPage?.isConnected)initFinesPage();

        },
        0
    );

})();
