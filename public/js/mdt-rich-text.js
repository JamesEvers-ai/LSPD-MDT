(function () {
  "use strict";
  if (window.MDTRichText) return;

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function inline(value) {
    var s = escapeHtml(value);
    // Use temporary tokens to prevent nested replacements from corrupting tags.
    var tokens = [];
    function token(html) { var key = "\u0000" + tokens.length + "\u0000"; tokens.push(html); return key; }
    s = s.replace(/\*\*([^*\n]+)\*\*/g, function (_, t) { return token("<strong>" + t + "</strong>"); });
    s = s.replace(/__([^_\n]+)__/g, function (_, t) { return token("<u>" + t + "</u>"); });
    s = s.replace(/\*([^*\n]+)\*/g, function (_, t) { return token("<em>" + t + "</em>"); });
    s = s.replace(/(^|[\s(])_([^_\n]+)_($|[\s).,!?:;])/g, function (_, a, t, b) { return a + token("<em>" + t + "</em>") + b; });
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return tokens[Number(i)] || ""; });
  }

  function cells(line) {
    var value = line.trim();
    if (value.charAt(0) === "|") value = value.slice(1);
    if (value.charAt(value.length - 1) === "|") value = value.slice(0, -1);
    return value.split("|").map(function (cell) { return cell.trim(); });
  }
  function isTableRule(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  }

  function render(value) {
    var lines = String(value == null ? "" : value).replace(/\r\n?/g, "\n").split("\n");
    var out = [], paragraph = [], list = false, i = 0;
    function flushParagraph() {
      if (paragraph.length) {
        out.push("<p>" + paragraph.map(inline).join("<br>") + "</p>");
        paragraph = [];
      }
    }
    function closeList() { if (list) { out.push("</ul>"); list = false; } }

    while (i < lines.length) {
      var line = lines[i], trimmed = line.trim();
      if (!trimmed) { flushParagraph(); closeList(); i++; continue; }

      if (i + 1 < lines.length && trimmed.indexOf("|") >= 0 && isTableRule(lines[i + 1])) {
        flushParagraph(); closeList();
        var headers = cells(line), rows = [], j = i + 2;
        while (j < lines.length && lines[j].trim().indexOf("|") >= 0 && lines[j].trim()) {
          rows.push(cells(lines[j])); j++;
        }
        out.push("<div class=\"mdt-rich-table-wrap\"><table class=\"mdt-rich-table\"><thead><tr>" +
          headers.map(function (h) { return "<th>" + inline(h) + "</th>"; }).join("") +
          "</tr></thead><tbody>" + rows.map(function (r) {
            return "<tr>" + headers.map(function (_, n) { return "<td>" + inline(r[n] || "") + "</td>"; }).join("") + "</tr>";
          }).join("") + "</tbody></table></div>");
        i = j; continue;
      }

      var heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        flushParagraph(); closeList();
        var level = heading[1].length;
        out.push("<h" + level + ">" + inline(heading[2]) + "</h" + level + ">");
        i++; continue;
      }

      var item = trimmed.match(/^[-*]\s+(.+)$/);
      if (item) {
        flushParagraph();
        if (!list) { out.push("<ul>"); list = true; }
        out.push("<li>" + inline(item[1]) + "</li>");
        i++; continue;
      }

      closeList();
      paragraph.push(line);
      i++;
    }
    flushParagraph(); closeList();
    return out.join("") || '<p class="mdt-rich-empty">Keine Beschreibung hinterlegt.</p>';
  }

  function insert(textarea, kind) {
    if (!textarea) return;
    var start = textarea.selectionStart || 0, end = textarea.selectionEnd || 0;
    var value = textarea.value, selected = value.slice(start, end), before = value.slice(0, start), after = value.slice(end);
    var prefix = "", suffix = "", replacement = selected || "Text";
    if (kind === "bold") { prefix = "**"; suffix = "**"; }
    else if (kind === "italic") { prefix = "*"; suffix = "*"; }
    else if (kind === "underline") { prefix = "__"; suffix = "__"; }
    else if (kind === "h1") replacement = "# " + (selected || "Überschrift");
    else if (kind === "h2") replacement = "## " + (selected || "Überschrift");
    else if (kind === "h3") replacement = "### " + (selected || "Überschrift");
    else if (kind === "list") replacement = (selected || "Listeneintrag").split("\n").map(function (line) { return "- " + line; }).join("\n");
    else if (kind === "table") replacement = "| Spalte 1 | Spalte 2 |\n| --- | --- |\n| Inhalt | Inhalt |";
    if (prefix) replacement = prefix + replacement + suffix;
    textarea.value = before + replacement + after;
    textarea.focus();
    var cursor = before.length + replacement.length;
    textarea.setSelectionRange(cursor, cursor);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function attachToolbar(root) {
    if (!root || root.dataset.mdtRichToolbar === "1") return;
    root.dataset.mdtRichToolbar = "1";
    root.addEventListener("click", function (event) {
      var button = event.target.closest("[data-mdt-format]");
      if (!button || !root.contains(button)) return;
      var targetId = button.getAttribute("data-target");
      var textarea = targetId ? root.querySelector("#" + targetId) : root.querySelector("textarea[data-mdt-editor]");
      if (!textarea) return;
      insert(textarea, button.getAttribute("data-mdt-format"));
    });
  }

  window.MDTRichText = { render: render, escapeHtml: escapeHtml, insert: insert, attachToolbar: attachToolbar };
})();
