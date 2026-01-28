// Markdown → HTML 変換とコピー処理

(() => {
  const markdownInput = document.getElementById("markdown-input");
  const htmlPreview = document.getElementById("html-preview");
  const htmlOutput = document.getElementById("html-output");
  const copyOnenoteButton = document.getElementById("copy-onenote-button");
  const copySlackButton = document.getElementById("copy-slack-button");
  const statusMessage = document.getElementById("status-message");

  if (!markdownInput || !htmlPreview || !htmlOutput || !copyOnenoteButton || !copySlackButton) {
    console.error("必要な要素が見つかりませんでした。");
    return;
  }

  // marked の基本設定（シンプルな出力を目指す）
  if (window.marked) {
    window.marked.setOptions({
      gfm: true,
      breaks: false,
      headerIds: false,
      mangle: false
    });
  }

  function clearStatus() {
    if (statusMessage) {
      statusMessage.textContent = "";
    }
  }

  function showStatus(message, type = "info") {
    if (!statusMessage) return;
    statusMessage.textContent = message;
    statusMessage.dataset.type = type;
  }

  function normalizeHtmlForOneNote(html) {
    // OneNote での崩れを防ぐための、ごく軽い後処理
    if (!html) return "";
    let result = html;

    // 不要な連続 <br> をある程度抑制（簡易）
    result = result.replace(/(<br>\s*){3,}/gi, "<br><br>");

    // 先頭と末尾の空白をトリム
    result = result.trim();

    return result;
  }

  const headingAllowlist = new Set(["決定事項", "アクション", "重要な共有事項"]);

  function stripBoldSyntax(text) {
    if (!text) return text;
    return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");
  }

  function stripBoldSyntaxOutsideCode(text) {
    if (!text) return text;

    const codeSpanPattern = /(`+)([\s\S]*?)\1/g;
    let result = "";
    let lastIndex = 0;
    let match = codeSpanPattern.exec(text);

    while (match) {
      const [fullMatch] = match;
      const start = match.index;
      const end = start + fullMatch.length;
      const before = text.slice(lastIndex, start);
      result += stripBoldSyntax(before);
      result += fullMatch;
      lastIndex = end;
      match = codeSpanPattern.exec(text);
    }

    result += stripBoldSyntax(text.slice(lastIndex));
    return result;
  }

  function removeBoldExceptAllowedHeadings(markdown) {
    if (!markdown) return "";

    let inCodeBlock = false;
    return markdown
      .split(/\r?\n/)
      .map((line) => {
        const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
        if (fenceMatch) {
          inCodeBlock = !inCodeBlock;
          return line;
        }

        if (inCodeBlock) {
          return line;
        }

        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
          const prefix = headingMatch[1];
          const headingText = headingMatch[2].trim();
          const normalizedHeading = stripBoldSyntaxOutsideCode(headingText).trim();
          if (headingAllowlist.has(normalizedHeading)) {
            return line;
          }
          return `${prefix} ${stripBoldSyntaxOutsideCode(headingMatch[2])}`;
        }

        return stripBoldSyntaxOutsideCode(line);
      })
      .join("\n");
  }

  // Slackで見やすくなるように、GitHub風Markdownを軽く変換する
  // - 見出し記号 (#, ##, ###...) を外して行全体を太字に
  // - **bold** 記法を Slack 形式の *bold* に変換
  function convertMarkdownForSlack(markdown) {
    if (!markdown) return "";

    const lines = markdown.split(/\r?\n/).map((line) => {
      // 見出し行: 「# タイトル」→「*タイトル*」
      const m = line.match(/^(#{1,6})\s+(.*)$/);
      if (m) {
        const content = m[2].trim();
        if (!content) return "";
        return `*${content}*`;
      }

      // 箇条書き（Slackは `-` がそのまま文字として残ることがあるので `•` に寄せる）
      // さらに、ネストはタブで段落下げしたリストにする（Tabキー挙動に近い）
      // 例:
      // - aaa        -> • aaa
      //   - bbb      -> \t• bbb
      //     - ccc    -> \t\t• ccc
      const bullet = line.match(/^([ \t]*)([-*+])\s+(.*)$/);
      if (bullet) {
        const indent = bullet[1] || "";
        const content = (bullet[3] || "").trim();
        if (!content) return "";

        const tabCount = (indent.match(/\t/g) || []).length;
        const spaceCount = indent.replace(/\t/g, "").length;
        const depth = Math.min(8, Math.max(0, tabCount + Math.floor(spaceCount / 2)));

        return `${"\t".repeat(depth)}• ${content}`;
      }

      // 番号付きリストも Slack 側で崩れやすいので、見た目優先で箇条書きに寄せる
      const ordered = line.match(/^([ \t]*)(\d+)\.\s+(.*)$/);
      if (ordered) {
        const indent = ordered[1] || "";
        const content = (ordered[3] || "").trim();
        if (!content) return "";

        const tabCount = (indent.match(/\t/g) || []).length;
        const spaceCount = indent.replace(/\t/g, "").length;
        const depth = Math.min(8, Math.max(0, tabCount + Math.floor(spaceCount / 2)));

        return `${"\t".repeat(depth)}• ${content}`;
      }

      return line;
    });

    const joined = lines.join("\n");

    // **bold** → *bold*
    // すでに Slack 形式になっている *text* はそのまま残す想定の単純変換
    return joined.replace(/\*\*(.+?)\*\*/g, "*$1*");
  }

  function convertMarkdown() {
    clearStatus();
    const markdown = removeBoldExceptAllowedHeadings(markdownInput.value || "");

    if (!markdown.trim()) {
      htmlPreview.innerHTML = "";
      htmlOutput.value = "";
      showStatus("Markdownが空です。何か入力してください。", "info");
      return;
    }

    try {
      let html = "";
      if (window.marked) {
        html = window.marked.parse(markdown);
      } else {
        // 万が一 marked が読み込めなかった場合のフォールバック（エスケープして表示）
        html = `<pre>${markdown
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</pre>`;
      }

      const normalized = normalizeHtmlForOneNote(html);

      htmlPreview.innerHTML = normalized;
      htmlOutput.value = normalized;
      // リアルタイム変換のため、成功時は特にメッセージを出さない
    } catch (e) {
      console.error(e);
      showStatus("変換中にエラーが発生しました。", "error");
    }
  }

  async function copyForOneNote() {
    clearStatus();

    const html = htmlOutput.value || "";
    if (!html.trim()) {
      showStatus("コピーする内容がありません。先に変換を実行してください。", "error");
      return;
    }

    try {
      // 可能なら Clipboard API で text/html としてコピー
      if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
        const blob = new Blob([html], { type: "text/html" });
        const item = new ClipboardItem({ "text/html": blob });
        await navigator.clipboard.write([item]);
        showStatus("プレビューの内容をHTML形式でコピーしました。OneNoteでそのまま貼り付けてください。", "success");
        return;
      }

      // フォールバック: プレビュー領域を選択して execCommand("copy")
      const selection = window.getSelection();
      if (!selection) {
        showStatus("コピーに失敗しました（選択が作れません）。", "error");
        return;
      }

      const range = document.createRange();
      range.selectNodeContents(htmlPreview);
      selection.removeAllRanges();
      selection.addRange(range);

      const ok = document.execCommand("copy");
      selection.removeAllRanges();

      if (ok) {
        showStatus("プレビューの内容をコピーしました。OneNoteでそのまま貼り付けてください。", "success");
      } else {
        showStatus("コピーに失敗しました。ブラウザの制限の可能性があります。", "error");
      }
    } catch (e) {
      console.error(e);
      showStatus("クリップボードへのコピーに失敗しました。", "error");
    }
  }

  async function copyForSlack() {
    clearStatus();
    const rawMarkdown = removeBoldExceptAllowedHeadings(markdownInput.value || "").trim();

    if (!rawMarkdown) {
      showStatus("コピーするMarkdownがありません。入力してください。", "error");
      return;
    }

    const slackText = convertMarkdownForSlack(rawMarkdown);

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(slackText);
        showStatus("Slack用として整形したテキストをコピーしました。Slackに貼り付けてください。", "success");
      } else {
        // フォールバック
        const ta = document.createElement("textarea");
        ta.value = slackText;
        ta.setAttribute("readonly", "true");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        showStatus("Slack用として整形したテキストをコピーしました（フォールバック）。", "success");
      }
    } catch (e) {
      console.error(e);
      showStatus("Slack用テキストのコピーに失敗しました。", "error");
    }
  }

  // 入力のたびにリアルタイムで変換
  markdownInput.addEventListener("input", convertMarkdown);
  copyOnenoteButton.addEventListener("click", copyForOneNote);
  copySlackButton.addEventListener("click", copyForSlack);

  // 初期表示も空入力として一度変換しておく
  convertMarkdown();
})();
