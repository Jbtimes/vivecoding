const RSS_URL = "https://api.rss2json.com/v1/api.json?rss_url=https://www.yna.co.kr/rss/news.xml";

let newsData = [];
let currentIndex = -1;
let synth = window.speechSynthesis;
let utterance = null;
let isPlaying = false;
let charToWordIndex = {}; // maps text character index to span id

// DOM Elements
const newsListEl = document.getElementById("news-list");
const articleTitleEl = document.getElementById("article-title");
const articleContentEl = document.getElementById("article-content");
const publishTimeEl = document.getElementById("publish-time");
const progressTextEl = document.getElementById("progress-text");
const currentStatusEl = document.getElementById("current-status");
const voiceSelect = document.getElementById("voice-select");

const btnPlayPause = document.getElementById("btn-play-pause");
const btnStop = document.getElementById("btn-stop");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const btnReload = document.getElementById("btn-reload");

// Update DateTime Display
function updateDateTime() {
    const now = new Date();
    const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' };
    document.getElementById("datetime-display").innerText = now.toLocaleDateString('ko-KR', options);
}
setInterval(updateDateTime, 1000);
updateDateTime();

// Fetch and Parse RSS
async function loadNews() {
    try {
        const response = await fetch(RSS_URL);
        if (!response.ok) throw new Error("Network response was not ok");
        const data = await response.json();
        
        if (data.status !== "ok") throw new Error("RSS feed to JSON failed");
        
        const items = data.items;
        newsData = [];
        
        items.forEach((item, index) => {
            const title = item.title || "제목 없음";
            let description = item.description || "내용 없음";
            // Remove CDATA if present and HTML tags inside description
            description = description.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
            description = description.replace(/<[^>]*>?/gm, ''); // Remove HTML tags
            
            const pubDate = item.pubDate || "";
            
            newsData.push({
                index,
                title,
                originalDescription: description,
                description: description,
                link: item.link || "",
                fullTextFetched: false,
                pubDate: new Date(pubDate.replace(/-/g, "/")).toLocaleString('ko-KR') // rss2json formats date differently sometimes
            });
        });

        renderNewsList();
        if (newsData.length > 0) {
            selectNews(0);
        }
    } catch (error) {
        console.error("Error loading news:", error);
        newsListEl.innerHTML = `<div class="loading-spinner"><i class="fas fa-exclamation-triangle"></i> 뉴스를 불러오는데 실패했습니다.</div>`;
    }
}

// Render News List
function renderNewsList() {
    newsListEl.innerHTML = "";
    newsData.forEach(news => {
        const itemEl = document.createElement("div");
        itemEl.className = "news-item";
        itemEl.id = `news-item-${news.index}`;
        itemEl.innerHTML = `
            <span class="news-item-time">${news.pubDate}</span>
            <div class="news-item-title">${news.title}</div>
        `;
        itemEl.addEventListener("click", () => {
            selectNews(news.index);
        });
        newsListEl.appendChild(itemEl);
    });
}

async function fetchFullFirstSentence(news) {
    if (news.fullTextFetched) return;
    try {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(news.link)}`;
        const response = await fetch(proxyUrl);
        const data = await response.json();
        const html = data.contents;
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        
        // Find the article body. Yonhap news uses <article> or .story-news
        const articleEls = doc.querySelectorAll('article p, .story-news p');
        let fullText = "";
        for (let p of articleEls) {
            fullText += p.innerText + " ";
        }
        
        if (!fullText.trim()) {
            fullText = news.originalDescription;
        }

        fullText = fullText.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
        fullText = fullText.replace(/<[^>]*>?/gm, ''); 
        
        // Remove reporter part: e.g. "(서울=연합뉴스) 홍길동 기자 ="
        let firstSentence = fullText.trim();
        const reporterMatch = firstSentence.match(/^.*?(기자|특파원)\s*=\s*/);
        if (reporterMatch && reporterMatch.index < 100) {
            firstSentence = firstSentence.substring(reporterMatch.index + reporterMatch[0].length);
        } else {
            // Fallback for simple " = "
            const equalsIdx = firstSentence.indexOf(" = ");
            if (equalsIdx !== -1 && equalsIdx < 50) {
                firstSentence = firstSentence.substring(equalsIdx + 3);
            }
        }
        
        // Extract the first sentence
        let sentences = firstSentence.split('. ');
        if (sentences.length > 1) {
            firstSentence = sentences[0] + '.';
        } else {
            let daSplit = firstSentence.split('다.');
            if (daSplit.length > 1) {
                firstSentence = daSplit[0] + '다.';
            }
        }
        
        news.description = firstSentence.trim();
        news.fullTextFetched = true;
    } catch (e) {
        console.error("Error fetching full text", e);
        // Fallback to original
        let firstSentence = news.originalDescription;
        const reporterMatch = firstSentence.match(/^.*?(기자|특파원)\s*=\s*/);
        if (reporterMatch) {
            firstSentence = firstSentence.substring(reporterMatch.index + reporterMatch[0].length);
        }
        let sentences = firstSentence.split('. ');
        if (sentences.length > 1) {
            firstSentence = sentences[0] + '.';
        }
        news.description = firstSentence.trim();
        news.fullTextFetched = true;
    }
}

// Select a News Item
async function selectNews(index) {
    if (index < 0 || index >= newsData.length) return;
    
    stopReading(); // Stop previous audio
    
    // Update active class
    if (currentIndex !== -1) {
        const prevItem = document.getElementById(`news-item-${currentIndex}`);
        if (prevItem) prevItem.classList.remove("active");
    }
    currentIndex = index;
    const currentItem = document.getElementById(`news-item-${currentIndex}`);
    if (currentItem) {
        currentItem.classList.add("active");
        currentItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    const news = newsData[currentIndex];
    publishTimeEl.innerText = news.pubDate;
    progressTextEl.innerText = `${currentIndex + 1} / ${newsData.length}`;
    
    if (!news.fullTextFetched) {
        currentStatusEl.innerText = "본문 가져오는 중...";
        await fetchFullFirstSentence(news);
        currentStatusEl.innerText = "대기 중";
    }

    prepareArticleText(news.title, news.description);
}

// Prepare text and wrap words in spans for highlighting
function prepareArticleText(title, description) {
    // We will read title, pause slightly, then read description
    const fullText = `${title}. ... ${description}`;
    
    let html = '';
    charToWordIndex = {};
    let wordIndex = 0;
    let currentCharIndex = 0;

    // Split by whitespace but keep the whitespace tokens
    const tokens = fullText.split(/(\s+)/);
    
    tokens.forEach(token => {
        if (token.trim() === '') {
            html += token;
            currentCharIndex += token.length;
        } else {
            html += `<span class="word" id="word-${wordIndex}">${token}</span>`;
            for (let i = 0; i < token.length; i++) {
                charToWordIndex[currentCharIndex + i] = wordIndex;
            }
            currentCharIndex += token.length;
            wordIndex++;
        }
    });

    articleTitleEl.innerHTML = `<span class="word" id="title-wrapper">${title}</span>`;
    articleContentEl.innerHTML = html;
    
    // Actually the above logic merges title and description, so let's separate them in display
    // but the word-index mapping spans across the whole text that will be fed to speech synthesis.
    // For cleaner display, we'll recreate HTML
    
    let titleHtml = '';
    let descHtml = '';
    charToWordIndex = {};
    currentCharIndex = 0;
    wordIndex = 0;
    
    // Process Title
    let titleTokens = title.split(/(\s+)/);
    titleTokens.forEach(token => {
        if (token.trim() === '') {
            titleHtml += token;
            currentCharIndex += token.length;
        } else {
            titleHtml += `<span class="word" id="word-${wordIndex}">${token}</span>`;
            for (let i = 0; i < token.length; i++) {
                charToWordIndex[currentCharIndex + i] = wordIndex;
            }
            currentCharIndex += token.length;
            wordIndex++;
        }
    });
    
    // Add separator for the dot and pause we add in text
    currentCharIndex += ". ... ".length; 

    // Process Description
    let descTokens = description.split(/(\s+)/);
    descTokens.forEach(token => {
        if (token.trim() === '') {
            descHtml += token;
            currentCharIndex += token.length;
        } else {
            descHtml += `<span class="word" id="word-${wordIndex}">${token}</span>`;
            for (let i = 0; i < token.length; i++) {
                charToWordIndex[currentCharIndex + i] = wordIndex;
            }
            currentCharIndex += token.length;
            wordIndex++;
        }
    });

    articleTitleEl.innerHTML = titleHtml;
    articleContentEl.innerHTML = descHtml;
}

// Voices Setup
let voices = [];
function populateVoiceList() {
    voices = synth.getVoices();
    voiceSelect.innerHTML = '';
    
    // Prioritize Korean voices
    const koVoices = voices.filter(voice => voice.lang.includes('ko'));
    const otherVoices = voices.filter(voice => !voice.lang.includes('ko'));
    
    const sortedVoices = [...koVoices, ...otherVoices];
    
    sortedVoices.forEach((voice, i) => {
        const option = document.createElement('option');
        option.textContent = `${voice.name} (${voice.lang})`;
        if (voice.default) option.textContent += ' -- DEFAULT';
        option.setAttribute('data-lang', voice.lang);
        option.setAttribute('data-name', voice.name);
        voiceSelect.appendChild(option);
    });
}
populateVoiceList();
if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = populateVoiceList;
}

// Play Audio
function playAudio() {
    if (synth.paused && isPlaying) {
        synth.resume();
        updatePlayBtnState(true);
        return;
    }

    if (synth.speaking) {
        synth.pause();
        updatePlayBtnState(false);
        return;
    }

    if (currentIndex === -1) return;

    const news = newsData[currentIndex];
    const textToSpeak = `${news.title}. ... ${news.description}`;
    
    utterance = new SpeechSynthesisUtterance(textToSpeak);
    
    const selectedOption = voiceSelect.selectedOptions[0].getAttribute('data-name');
    for(let i = 0; i < voices.length ; i++) {
        if(voices[i].name === selectedOption) {
            utterance.voice = voices[i];
            break;
        }
    }
    
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    
    // Highlight Text on Boundary
    utterance.onboundary = (event) => {
        if (event.name !== 'word') return;
        
        const wIndex = charToWordIndex[event.charIndex];
        if (wIndex !== undefined) {
            // Remove previous highlight
            document.querySelectorAll('.word.highlight').forEach(el => el.classList.remove('highlight'));
            // Add new highlight
            const activeWordEl = document.getElementById(`word-${wIndex}`);
            if (activeWordEl) {
                activeWordEl.classList.add('highlight');
                // Scroll the content display if needed
                activeWordEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    };

    utterance.onstart = () => {
        isPlaying = true;
        updatePlayBtnState(true);
        currentStatusEl.innerText = "읽는 중...";
    };

    utterance.onend = () => {
        isPlaying = false;
        updatePlayBtnState(false);
        currentStatusEl.innerText = "대기 중";
        document.querySelectorAll('.word.highlight').forEach(el => el.classList.remove('highlight'));
        
        // Auto-play next if available
        if (currentIndex < newsData.length - 1) {
            setTimeout(async () => {
                let currentIsPlaying = isPlaying; // Save state in case it was cancelled
                await selectNews(currentIndex + 1);
                // We shouldn't autoplay if user manually stopped during the fetch
                if (!synth.paused && !synth.speaking) {
                     playAudio();
                }
            }, 1000);
        }
    };
    
    utterance.onerror = (e) => {
        console.error("Speech Synthesis Error", e);
        isPlaying = false;
        updatePlayBtnState(false);
        currentStatusEl.innerText = "오류 발생";
    }

    synth.speak(utterance);
}

function stopReading() {
    synth.cancel();
    isPlaying = false;
    updatePlayBtnState(false);
    currentStatusEl.innerText = "대기 중";
    document.querySelectorAll('.word.highlight').forEach(el => el.classList.remove('highlight'));
}

function updatePlayBtnState(playing) {
    if (playing) {
        btnPlayPause.innerHTML = '<i class="fas fa-pause"></i>';
    } else {
        btnPlayPause.innerHTML = '<i class="fas fa-play"></i>';
    }
}

// Event Listeners
btnPlayPause.addEventListener("click", playAudio);
btnStop.addEventListener("click", stopReading);

btnNext.addEventListener("click", async () => {
    if (currentIndex < newsData.length - 1) {
        const wasPlaying = isPlaying;
        await selectNews(currentIndex + 1);
        if (wasPlaying) playAudio();
    }
});

btnPrev.addEventListener("click", async () => {
    if (currentIndex > 0) {
        const wasPlaying = isPlaying;
        await selectNews(currentIndex - 1);
        if (wasPlaying) playAudio();
    }
});

btnReload.addEventListener("click", () => {
    stopReading();
    newsListEl.innerHTML = `<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i> 뉴스를 불러오는 중...</div>`;
    loadNews();
});

// Init
window.addEventListener('beforeunload', () => synth.cancel());
loadNews();
