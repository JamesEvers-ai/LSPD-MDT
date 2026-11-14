

/* =========================================================
   STATE
   ========================================================= */

window.fibWarrantState = {

  warrants: [],

  filtered: [],

  initialized: false

};


/* =========================================================
   INITIALISIERUNG
   ========================================================= */

function initializeWarrants() {

  const state =
    window.fibWarrantState;


  if (state.initialized) {

    renderWarrants();

    updateWarrantStatistics();

    return;

  }


  state.initialized = true;


  const search =
    document.getElementById(
      "warrantsSearch"
    );


  if (search) {

    search.addEventListener(
      "input",
      filterWarrants
    );

  }


  const refreshButton =
    document.getElementById(
      "warrantsRefreshButton"
    );


  if (refreshButton) {

    refreshButton.addEventListener(
      "click",
      refreshWarrants
    );

  }


  loadWarrants();

}


/* =========================================================
   LADEN
   ========================================================= */

function loadWarrants(
  forceRefresh = false
) {

  const state =
    window.fibWarrantState;


  const list =
    document.getElementById(
      "warrantsList"
    );


  const clientCache =
    forceRefresh
      ? null
      : getWarrantClientCache_();


  if (
    clientCache &&
    Array.isArray(
      clientCache.data
    )
  ) {

    state.warrants =
      clientCache.data;

    filterWarrants();

    return;

  }


  if (list) {

    list.innerHTML = `

      <div class="warrants-loading">
        Haftbefehle werden geladen...
      </div>

    `;

  }


  CloudApi.run

    .withSuccessHandler(
      data => {

        state.warrants =
          Array.isArray(data)
            ? data
            : [];


        setWarrantClientCache_(
          state.warrants
        );


        filterWarrants();

      }
    )

    .withFailureHandler(
      error => {

        showWarrantError(

          error &&
          error.message

            ? error.message

            : "Die Haftbefehle konnten nicht geladen werden."

        );

      }
    )

    .getWarrants(
      sessionToken
    );

}


/* =========================================================
   AKTUALISIEREN
   ========================================================= */

function refreshWarrants() {

  window.FIBMDTCache?.refresh("getWarrants");

  const button =
    document.getElementById(
      "warrantsRefreshButton"
    );


  if (button) {

    button.disabled =
      true;

    button.textContent =
      "↻ Aktualisiere...";

  }


  try {

    sessionStorage.removeItem(
      "fib_mdt_warrants"
    );

  } catch (error) {

    console.warn(
      "Browser-Cache konnte nicht gelöscht werden.",
      error
    );

  }


  CloudApi.run

    .withSuccessHandler(
      data => {

        const state =
          window.fibWarrantState;


        state.warrants =
          Array.isArray(data)
            ? data
            : [];


        setWarrantClientCache_(
          state.warrants
        );


        filterWarrants();


        if (button) {

          button.disabled =
            false;

          button.textContent =
            "↻ Aktualisieren";

        }

      }
    )

    .withFailureHandler(
      error => {

        if (button) {

          button.disabled =
            false;

          button.textContent =
            "↻ Aktualisieren";

        }


        showWarrantError(

          error &&
          error.message

            ? error.message

            : "Die Haftbefehle konnten nicht aktualisiert werden."

        );

      }
    )

    .refreshWarrantsCache(
      sessionToken
    );

}


/* =========================================================
   PRÜFUNG:
   TATSÄCHLICH EINGEREICHTER HAFTBEFEHL
   ========================================================= */

function isUsableWarrant_(
  warrant
) {

  if (!warrant) {

    return false;

  }


  /*
   * ENTSCHEIDEND:
   *
   * Die vorbereiteten Haftbefehle können bereits
   * einzelne Felder besitzen.
   *
   * Deshalb zählt NICHT:
   *
   * warrant
   * fileNumber
   * priority
   * defendant
   * crime
   * approvalDate
   * processor
   *
   * allein als Nachweis.
   *
   * Ein Datensatz gilt erst als eingereicht,
   * wenn "crimeDetails" tatsächlich einen
   * Inhalt enthält.
   */

  return isCompletedWarrant_(
    warrant.crimeDetails
  );

}


/* =========================================================
   PRÜFUNG CRIME DETAILS
   ========================================================= */

function isCompletedWarrant_(
  value
) {

  const text =
    String(
      value ?? ""
    ).trim();


  /*
   * Komplett leer
   */

  if (!text) {

    return false;

  }


  /*
   * Nur ein einzelner Platzhalter
   */

  if (
    text === "-" ||
    text === "—" ||
    text === "–" ||
    text === "."
  ) {

    return false;

  }


  /*
   * Nur Datum / Datum + Uhrzeit
   *
   * Solche Werte stammen von noch nicht
   * eingereichten vorbereiteten Haftbefehlen.
   *
   * Beispiele:
   *
   * 14.09.2026
   * 14.09.2026 17:06
   * 14.09.2026 17:06 Uhr
   *
   * 2026-09-14
   * 2026-09-14 17:06
   */

  const onlyDateTimePattern =
    /^\s*(?:(?:\d{1,2}[./-]\d{1,2}[./-]\d{4})|(?:\d{4}[./-]\d{1,2}[./-]\d{1,2}))(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?(?:\s*Uhr)?\s*$/i;


  if (
    onlyDateTimePattern.test(
      text
    )
  ) {

    return false;

  }


  /*
   * Echter zusätzlicher Inhalt vorhanden:
   * Der Haftbefehl gilt als eingereicht.
   */

  return true;

}


/* =========================================================
   FILTER
   ========================================================= */

function filterWarrants() {

  const state =
    window.fibWarrantState;


  const searchInput =
    document.getElementById(
      "warrantsSearch"
    );


  const search =
    searchInput

      ? searchInput.value
          .trim()
          .toLowerCase()

      : "";


  /*
   * Zuerst ausschließlich echte/eingereichte
   * Haftbefehle bestimmen.
   */

  const validWarrants =
    state.warrants.filter(
      isUsableWarrant_
    );


  /*
   * Danach Suchfilter anwenden.
   *
   * Die Statistik verwendet später weiterhin
   * validWarrants und NICHT state.filtered.
   */

  state.filtered =
    validWarrants.filter(
      warrant => {

        if (!search) {

          return true;

        }


        const searchable = [

          warrant.warrant,

          warrant.fileNumber,

          warrant.priority,

          warrant.defendant,

          warrant.crime,

          warrant.approvalDate,

          warrant.processor,

          warrant.crimeDetails

        ]

          .map(
            value =>
              String(
                value ?? ""
              ).toLowerCase()
          )

          .join(" ");


        return searchable.includes(
          search
        );

      }
    );


  renderWarrants();

  updateWarrantStatistics();

}


/* =========================================================
   STATISTIKEN
   ========================================================= */

function updateWarrantStatistics() {

  const state =
    window.fibWarrantState;


  /*
   * WICHTIG:
   *
   * Nur tatsächlich eingereichte Haftbefehle.
   *
   * Die aktuelle Suchanfrage wird bewusst
   * NICHT berücksichtigt.
   */

  const warrants =
    state.warrants.filter(
      isUsableWarrant_
    );


  const total =
    warrants.length;


  let high =
    0;

  let medium =
    0;

  let low =
    0;

  let normal =
    0;

  let undercover =
    0;


  const crimeCounts = {};


  warrants.forEach(
    warrant => {

      const priority =
        String(
          warrant.priority ?? ""
        )
          .trim()
          .toLowerCase();


      /*
       * PRIORITÄT
       */

      if (
        priority.includes(
          "untergetaucht"
        )
      ) {

        undercover++;

      }

      else if (
        priority.includes(
          "hoch"
        ) ||
        priority.includes(
          "dringend"
        ) ||
        priority.includes(
          "kritisch"
        )
      ) {

        high++;

      }

      else if (
        priority.includes(
          "mittel"
        )
      ) {

        medium++;

      }

      else if (
        priority.includes(
          "niedrig"
        ) ||
        priority.includes(
          "gering"
        )
      ) {

        low++;

      }

      else {

        /*
         * Alles andere = Normal.
         *
         * Dadurch werden insbesondere
         * Haftbefehle mit "Normal" korrekt gezählt.
         */

        normal++;

      }


      /*
       * =====================================================
       * STRAFTATEN
       * =====================================================
       */

      const crime =
        String(
          warrant.crime ?? ""
        ).trim();


      if (
        crime &&
        crime !== "-" &&
        crime !== "—" &&
        crime !== "–"
      ) {

        const key =
          normalizeWarrantCrime_(
            crime
          );


        if (
          !crimeCounts[key]
        ) {

          crimeCounts[key] = {

            label:
              crime,

            count:
              0

          };

        }


        crimeCounts[key].count++;

      }

    }
  );


  /*
   * =======================================================
   * STATISTIK-KARTEN
   * =======================================================
   */

  setWarrantStatisticValue_(
    "warrantStatTotal",
    total
  );


  setWarrantStatisticValue_(
    "warrantStatHigh",
    high
  );


  setWarrantStatisticValue_(
    "warrantStatMedium",
    medium
  );


  setWarrantStatisticValue_(
    "warrantStatLow",
    low
  );


  setWarrantStatisticValue_(
    "warrantStatNormal",
    normal
  );


  setWarrantStatisticValue_(
    "warrantStatUndercover",
    undercover
  );


  /*
   * =======================================================
   * PRIORITÄTSVERTEILUNG
   * =======================================================
   */

  setWarrantStatisticValue_(
    "warrantPriorityTotal",
    total
  );


  const priorityList =
    document.getElementById(
      "warrantPriorityList"
    );


  if (priorityList) {

    const priorityData = [

      {
        label:
          "Hoch",

        count:
          high,

        css:
          "high"

      },

      {
        label:
          "Mittel",

        count:
          medium,

        css:
          "medium"

      },

      {
        label:
          "Niedrig",

        count:
          low,

        css:
          "low"

      },

      {
        label:
          "Normal",

        count:
          normal,

        css:
          "normal"

      },

      {
        label:
          "Untergetaucht",

        count:
          undercover,

        css:
          "undercover"

      }

    ];


    const maximum =
      Math.max(
        1,
        ...priorityData.map(
          item =>
            item.count
        )
      );


    priorityList.innerHTML =

      priorityData.map(
        item => {

          const width =
            item.count > 0

              ? Math.max(
                  4,
                  (
                    item.count /
                    maximum
                  ) * 100
                )

              : 0;


          return `

            <div class="warrants-priority-row">

              <div class="warrants-priority-name">
                ${escapeWarrantHtml(
                  item.label
                )}
              </div>


              <div class="warrants-priority-bar">

                <div
                  class="warrants-priority-fill ${item.css}"
                  style="width:${width}%"
                ></div>

              </div>


              <div class="warrants-priority-count">
                ${item.count}
              </div>

            </div>

          `;

        }
      ).join("");

  }


  /*
   * Straftatstatistik
   */

  updateWarrantCrimeStatistics(
    crimeCounts
  );

}


/* =========================================================
   STRAFTATSTATISTIK
   ========================================================= */

function updateWarrantCrimeStatistics(
  crimeCounts
) {

  const list =
    document.getElementById(
      "warrantCrimeList"
    );


  const badge =
    document.getElementById(
      "warrantCrimeTotal"
    );


  const entries =
    Object.values(
      crimeCounts
    );


  if (badge) {

    badge.textContent =
      entries.length;

  }


  if (!list) {

    return;

  }


  const sorted =
    entries

      .sort(
        (a, b) =>
          b.count -
          a.count
      )

      .slice(
        0,
        10
      );


  if (!sorted.length) {

    list.innerHTML = `

      <div class="warrants-analysis-empty">
        Keine Straftaten vorhanden.
      </div>

    `;

    return;

  }


  const maximum =
    Math.max(
      1,
      ...sorted.map(
        item =>
          item.count
      )
    );


  list.innerHTML =

    sorted.map(
      item => {

        const width =
          Math.max(
            4,
            (
              item.count /
              maximum
            ) * 100
          );


        return `

          <div class="warrants-crime-row">

            <div
              class="warrants-crime-name"
              title="${escapeWarrantHtml(
                item.label
              )}"
            >
              ${escapeWarrantHtml(
                item.label
              )}
            </div>


            <div class="warrants-crime-bar">

              <div
                class="warrants-crime-fill"
                style="width:${width}%"
              ></div>

            </div>


            <div class="warrants-crime-count">
              ${item.count}
            </div>

          </div>

        `;

      }
    ).join("");

}


/* =========================================================
   STATISTIK-WERT SETZEN
   ========================================================= */

function setWarrantStatisticValue_(
  id,
  value
) {

  const element =
    document.getElementById(
      id
    );


  if (element) {

    element.textContent =
      String(value);

  }

}


/* =========================================================
   STRAFTAT NORMALISIEREN
   ========================================================= */

function normalizeWarrantCrime_(
  crime
) {

  return String(
    crime ?? ""
  )
    .trim()
    .toLowerCase()
    .replace(
      /\s+/g,
      " "
    );

}


/* =========================================================
   RENDER
   ========================================================= */

function renderWarrants() {

  const state =
    window.fibWarrantState;


  const list =
    document.getElementById(
      "warrantsList"
    );


  const count =
    document.getElementById(
      "warrantsCount"
    );


  if (!list) {

    return;

  }


  const warrants =
    state.filtered;


  if (count) {

    count.textContent =
      warrants.length === 1

        ? "1 Haftbefehl"

        : `${warrants.length} Haftbefehle`;

  }


  if (!warrants.length) {

    list.innerHTML = `

      <div class="warrants-empty">
        Keine Haftbefehle gefunden.
      </div>

    `;

    return;

  }


  list.innerHTML = "";


  warrants.forEach(
    (warrant, index) => {

      list.appendChild(

        createWarrantCard(
          warrant,
          index
        )

      );

    }
  );

}


/* =========================================================
   CARD ERSTELLEN
   ========================================================= */

function createWarrantCard(
  warrant,
  index
) {

  const card =
    document.createElement(
      "div"
    );


  card.className =
    "warrant-card";


  const priority =
    String(
      warrant.priority ?? ""
    ).trim();


  const isUndergetaucht =
    isWarrantUndergetaucht_(
      priority
    );


  const displayedPriority =
    isUndergetaucht

      ? "Untergetaucht"

      : (
          priority ||
          "Normal"
        );


  const priorityClass =
    isUndergetaucht

      ? "priority-untergetaucht"

      : getWarrantPriorityClass_(
          priority
        );


  card.innerHTML = `

    <div class="warrant-card-top">


      <!-- HAFTBEFEHL -->

      <div class="warrant-field">

        <div class="warrant-field-label">
          Haftbefehl
        </div>

        <div class="warrant-number">

          ${escapeWarrantHtml(
            warrant.warrant ||
            "—"
          )}

        </div>

      </div>


      <!-- AKTENZEICHEN -->

      <div class="warrant-field">

        <div class="warrant-field-label">
          Aktenzeichen
        </div>

        <div class="warrant-field-value">

          ${escapeWarrantHtml(
            warrant.fileNumber ||
            "—"
          )}

        </div>

      </div>


      <!-- PRIORITÄT -->

      <div class="warrant-field">

        <div class="warrant-field-label">
          Priorität
        </div>

        <div
          class="warrant-priority ${priorityClass}"
        >

          ${escapeWarrantHtml(
            displayedPriority
          )}

        </div>

      </div>


      <!-- BESCHULDIGTER -->

      <div class="warrant-field">

        <div class="warrant-field-label">
          Beschuldigter
        </div>

        <div class="warrant-defendant">

          ${escapeWarrantHtml(
            warrant.defendant ||
            "Unbekannt"
          )}

        </div>


        <div class="warrant-processor">

          <div class="warrant-field-label">
            Bearbeiter
          </div>

          <div class="warrant-processor-value">

            ${escapeWarrantHtml(
              warrant.processor ||
              "—"
            )}

          </div>

        </div>

      </div>


      <!-- STRAFTAT -->

      <div class="warrant-field">

        <div class="warrant-field-label">
          Begangene Straftat
        </div>

        <div class="warrant-crime">

          ${escapeWarrantHtml(
            warrant.crime ||
            "Keine Angabe"
          )}

        </div>

      </div>

    </div>


    <!-- =================================================
         DETAILBEREICH
         ================================================= -->

    <div class="warrant-card-details">


      <!-- GENEHMIGUNGSDATUM -->

      <div class="warrant-detail">

        <div class="warrant-detail-label">
          Genehmigungsdatum
        </div>

        <div class="warrant-detail-value">

          ${escapeWarrantHtml(
            warrant.approvalDate ||
            "—"
          )}

        </div>

      </div>


      <!-- STRAFTATDETAILS -->

      <div class="warrant-crime-details-wrapper">

        <div class="warrant-detail-label">

          Straftat inklusive Datum, Uhrzeit und Aktenzeichen

        </div>


        <div class="warrant-crime-details-row">

          <div
            class="warrant-crime-details"
            title="${escapeWarrantHtml(
              warrant.crimeDetails ||
              ""
            )}"
          >

            ${escapeWarrantHtml(
              warrant.crimeDetails ||
              "—"
            )}

          </div>


          <button
            class="warrant-copy-button"
            type="button"
            title="Vollständigen Originaltext kopieren"
          >
            ⧉
          </button>

        </div>

      </div>

    </div>

  `;


  const copyButton =
    card.querySelector(
      ".warrant-copy-button"
    );


  if (copyButton) {

    copyButton.addEventListener(
      "click",
      () => {

        copyWarrantDetails(
          warrant.crimeDetails ||
          "",
          copyButton
        );

      }
    );

  }


  return card;

}


/* =========================================================
   PRIORITÄTSKLASSE
   ========================================================= */

function getWarrantPriorityClass_(
  priority
) {

  const value =
    String(
      priority || ""
    )
      .trim()
      .toLowerCase();


  if (
    value.includes("hoch") ||
    value.includes("dringend") ||
    value.includes("kritisch")
  ) {

    return "priority-hoch";

  }


  if (
    value.includes("mittel")
  ) {

    return "priority-mittel";

  }


  if (
    value.includes("niedrig") ||
    value.includes("gering")
  ) {

    return "priority-niedrig";

  }


  return "priority-normal";

}


/* =========================================================
   UNTERGETAUCHT
   ========================================================= */

function isWarrantUndergetaucht_(
  priority
) {

  return String(
    priority ?? ""
  )
    .trim()
    .toLowerCase()
    .includes(
      "untergetaucht"
    );

}


/* =========================================================
   COPY
   ========================================================= */

function copyWarrantDetails(
  text,
  button
) {

  const value =
    String(
      text ?? ""
    );


  if (!value) {

    showWarrantError(
      "Für diesen Haftbefehl sind keine Tatdetails hinterlegt."
    );

    return;

  }


  const copied =
    () => {

      if (!button) {

        return;

      }


      button.classList.add(
        "copied"
      );


      button.textContent =
        "✓";


      setTimeout(
        () => {

          button.classList.remove(
            "copied"
          );

          button.textContent =
            "⧉";

        },
        1300
      );

    };


  if (
    navigator.clipboard &&
    navigator.clipboard.writeText
  ) {

    navigator.clipboard

      .writeText(
        value
      )

      .then(
        copied
      )

      .catch(
        () => {

          copyWarrantFallback_(
            value,
            copied
          );

        }
      );


    return;

  }


  copyWarrantFallback_(
    value,
    copied
  );

}


/* =========================================================
   COPY FALLBACK
   ========================================================= */

function copyWarrantFallback_(
  text,
  successCallback
) {

  const textarea =
    document.createElement(
      "textarea"
    );


  textarea.value =
    text;


  textarea.style.position =
    "fixed";

  textarea.style.left =
    "-9999px";


  document.body.appendChild(
    textarea
  );


  textarea.focus();

  textarea.select();


  try {

    const success =
      document.execCommand(
        "copy"
      );


    textarea.remove();


    if (success) {

      successCallback();

      return;

    }

  } catch (error) {

    textarea.remove();

  }


  showWarrantError(
    "Der Text konnte nicht kopiert werden."
  );

}


/* =========================================================
   CLIENT CACHE
   ========================================================= */

function getWarrantClientCache_() {

  try {

    const raw =
      sessionStorage.getItem(
        "fib_mdt_warrants"
      );


    if (!raw) {

      return null;

    }


    const parsed =
      JSON.parse(
        raw
      );


    if (
      !parsed.timestamp ||
      Date.now() -
        parsed.timestamp >
        30000
    ) {

      sessionStorage.removeItem(
        "fib_mdt_warrants"
      );

      return null;

    }


    return parsed;

  } catch (error) {

    return null;

  }

}


/* =========================================================
   CACHE SPEICHERN
   ========================================================= */

function setWarrantClientCache_(
  data
) {

  try {

    sessionStorage.setItem(

      "fib_mdt_warrants",

      JSON.stringify({

        timestamp:
          Date.now(),

        data:
          Array.isArray(data)
            ? data
            : []

      })

    );

  } catch (error) {

    console.warn(
      "Haftbefehle konnten nicht im Browser-Cache gespeichert werden.",
      error
    );

  }

}


/* =========================================================
   FEHLER
   ========================================================= */

function showWarrantError(
  message
) {

  const existing =
    document.getElementById(
      "warrantError"
    );


  if (existing) {

    existing.remove();

  }


  const error =
    document.createElement(
      "div"
    );


  error.id =
    "warrantError";


  error.textContent =
    message;


  document.body.appendChild(
    error
  );


  setTimeout(
    () => {

      if (error) {

        error.remove();

      }

    },
    4500
  );

}


/* =========================================================
   HTML ESCAPING
   ========================================================= */

function escapeWarrantHtml(
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
   START
   ========================================================= */

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    initializeWarrants
  );

} else {

  initializeWarrants();

}

