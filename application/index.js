"use strict";

import {
  bottom_bar,
  side_toaster,
  load_ads,
  top_bar,
  getManifest,
  setTabindex,
  downloadFile,
} from "./assets/js/helper.js";
import { stop_scan, start_scan } from "./assets/js/scan.js";
import localforage from "localforage";
import {
  geolocation,
  pushLocalNotification,
  detectMobileOS,
} from "./assets/js/helper.js";
import m from "mithril";
import qrious from "qrious";
import { v4 as uuidv4 } from "uuid";
import * as sanitizeHtml from "sanitize-html";

import Parser from "rss-parser";

import dayjs from "dayjs";

import duration from "dayjs/plugin/duration";

// Extend dayjs with the duration plugin
dayjs.extend(duration);

const parser = new Parser();

//github.com/laurentpayot/minidenticons#usage
export let status = {
  visibility: true,
  action: "",
  deviceOnline: true,
  notKaiOS: window.innerWidth > 300 ? true : false,
  os: detectMobileOS(),
  debug: false,
};

export let settings = {};

let read_articles = [];
// Load the array from localForage (on app startup)
localforage
  .getItem("read_articles")
  .then((value) => {
    if (value === null) {
      // Item does not exist, initialize it as an empty array
      read_articles = [];
      return localforage.setItem("read_articles", read_articles).then(() => {
        console.log(
          "Array initialized and stored in localForage:",
          read_articles
        );
      });
    } else {
      // Item exists, store it in the global variable

      read_articles = value;
      console.log("Array loaded from localForage:", read_articles);
    }
  })
  .catch((err) => {
    console.error("Error accessing localForage:", err);
  });

function add_read_article(id) {
  // Add the article to the global array
  let ids = [];
  articles.map((h, i) => {
    ids.push(h.id);
  });

  //clean
  read_articles = read_articles.filter((article) => ids.includes(id));

  read_articles.push(id);

  // Sync the updated array with localForage
  localforage
    .setItem("read_articles", read_articles)
    .then(() => {})
    .catch((err) => {
      console.error("Error updating localForage:", err);
    });
}

let xml_parser = new DOMParser();

let feed_download_list = [];

if ("b2g" in navigator || "navigator.mozApps" in navigator)
  status.notKaiOS = false;

if (!status.notKaiOS) {
  const scripts = [
    "./assets/js/kaiads.v5.min.js",
    "http://127.0.0.1/api/v1/shared/core.js",
    "http://127.0.0.1/api/v1/shared/session.js",
    "http://127.0.0.1/api/v1/apps/service.js",
  ];

  scripts.forEach((src) => {
    const js = document.createElement("script");
    js.type = "text/javascript";
    js.src = src;
    document.head.appendChild(js);
  });
}

let articles = [];
const channel = new BroadcastChannel("sw-messages");

if (status.debug) {
  window.onerror = function (msg, url, linenumber) {
    alert(
      "Error message: " + msg + "\nURL: " + url + "\nLine Number: " + linenumber
    );
    return true;
  };
}

//open KaiOS app
let app_launcher = () => {
  var currentUrl = window.location.href;

  // Check if the URL includes 'id='
  if (!currentUrl.includes("id=")) return false;

  setTimeout(() => {
    try {
      const activity = new MozActivity({
        name: "flop",
        data: window.location.href,
      });
      activity.onsuccess = function () {
        console.log("Activity successfuly handled");
      };

      activity.onerror = function () {
        console.log("The activity encouter en error: " + this.error);
        alert(this.error);
      };
    } catch (e) {}
    if ("b2g" in navigator) {
      try {
        let activity = new WebActivity("flop", {
          name: "flop",
          type: "url",
          data: window.location.href,
        });
        activity.start().then(
          (rv) => {
            console.log("Results passed back from activity handler:");
            console.log(rv);
          },
          (err) => {
            alert(err);
          }
        );
      } catch (e) {}
    }
  }, 4000);
};

function stringToHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char; // Bitwise shift
    hash |= 0; // Convert to 32-bit integer
  }
  return hash.toString(36); // Convert to base-36 for a shorter result
}

//clean input

let clean = (i) => {
  return sanitizeHtml(i, {
    allowedTags: ["b", "i", "em", "strong", "a", "img"],
    allowedAttributes: {
      "a": ["href"],
    },
  });
};

const fetchOPML = (url) => {
  return fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      // Read the response body
      return response.text();
    })
    .then((data) => {
      // Store the OPML content in local storage
      localStorage.setItem("opml_content", data);
      // Always call load_feeds to process the content
      load_feeds(); // Process the content (newly fetched data)
    })
    .catch((error) => {
      console.error("Error fetching the OPML file:", error);
      // Always call load_feeds even if there's an error to ensure processing with available data
      load_feeds(); // This will handle cases where fetching fails but local data is still available
    });
};

const load_feeds = async () => {
  // Retrieve the stored OPML content from local storage
  const data = localStorage.getItem("opml_content");

  if (data) {
    // Process the OPML data
    const xmlDoc = xml_parser.parseFromString(data, "text/xml");
    const content = xmlDoc.querySelector("body");

    if (!content) {
      console.error("No 'body' element found in the OPML data.");
      return;
    }

    let index = 0;
    const outlines = content.querySelectorAll("outline");

    // Create a Set for faster URL lookups
    const existingUrls = new Set(feed_download_list.map((feed) => feed.url));

    outlines.forEach((outline) => {
      const nestedOutlines = outline.querySelectorAll("outline");

      nestedOutlines.forEach((nested) => {
        const url = nested.getAttribute("xmlUrl");
        if (!url) return; // Skip if no url attribute

        // If URL is already in the feed_download_list, skip it
        if (existingUrls.has(url)) {
          source_url_cleaner.push(url); // Ensure source_url_cleaner is defined globally
        } else {
          // Add new feed to the list
          feed_download_list.push({
            error: "",
            title: nested.getAttribute("title") || "Untitled",
            url: url,
            amount: 5,
            index: index++,
            channel: outline.getAttribute("text") || "Unknown",
            type: nested.getAttribute("type") || "rss",
          });
          existingUrls.add(url); // Add new URL to Set
        }
      });
    });

    // Optionally: Store the updated feed_download_list back to localStorage
    try {
      localStorage.setItem(
        "feed_download_list",
        JSON.stringify(feed_download_list)
      );

      for (let e of feed_download_list) {
        try {
          // Await the asynchronous operation
          const a = await parser.parseURL(e.url);
          if (a.items)
            a.items.forEach((f, i) => {
              if (i > 5) return;
              f.channel = e.channel;
              f.id = stringToHash(f.title + f.pubDate);

              articles.push(f);

              articles.sort(
                (a, b) => new Date(b.isoDate) - new Date(a.isoDate)
              );
            });
        } catch (err) {
          console.error(err);
        }
      }
    } catch (e) {
      console.error("Error saving feed_download_list to localStorage:", e);
    }
  } else {
    console.error("No OPML content found in localStorage.");
  }
};

// Example usage
fetchOPML(
  "https://raw.githubusercontent.com/strukturart/feedolin/master/example.opml"
);

//callback qr-code scan
let scan_callback = function (n) {
  //maybe add new view "try to connect with funny animation"
};

var root = document.getElementById("app");

var about = {
  view: function () {
    return m(
      "div",
      {
        class: "page",
        oncreate: () => {
          top_bar("", "", "");

          if (status.notKaiOS)
            top_bar("", "", "<img src='assets/image/back.svg'>");

          bottom_bar(
            "",
            "<img class='not-desktop' src='assets/image/select.svg'>",
            ""
          );
        },
      },
      [
        m(
          "button",
          {
            tabindex: 0,

            class: "item",
            oncreate: ({ dom }) => {
              dom.focus();
            },
            onclick: () => {
              m.route.set("/about_page");
            },
          },
          "About"
        ),
        m(
          "button",
          {
            tabindex: 1,

            class: "item",
            onclick: () => {
              m.route.set("/settings_page");
            },
          },
          "Settings"
        ),

        m(
          "button",
          {
            tabindex: 2,

            class: "item",
            onclick: () => {
              m.route.set("/privacy_policy");
            },
          },
          "Privacy Policy"
        ),
        m("div", {
          id: "KaiOSads-Wrapper",
          class: "width-100",

          oncreate: () => {
            if (status.notKaiOS == false) load_ads();
          },
        }),
      ]
    );
  },
};

var options = {
  view: function () {
    return m("div");
  },
};

var start = {
  view: function () {
    return m(
      "div",
      {
        class: "debug",
        id: "start",
        oncreate: () => {
          bottom_bar(
            "<img src='assets/icons/list.svg'>",
            "<img src='assets/icons/select.svg'>",
            "<img src='assets/icons/option.svg'>"
          );
        },
      },
      articles.map((h, i) => {
        var index = m.route.param("index") ? m.route.param("index") : 0;

        // Limit to the first 6 articles
        return m(
          "article",
          {
            class: "item",
            tabindex: i,
            "data-id": h.id,
            oncreate: (vnode) => {
              if (i == index) vnode.dom.focus();

              if (read_articles.indexOf(h.id) > -1) {
                vnode.dom.classList.add("read");
              }
            },
            onclick: () => {
              m.route.set("/article/?index=" + i);
              add_read_article(h.id);
            },

            onkeydown: (e) => {
              if (e.key === "Enter") {
                m.route.set("/article/?index=" + i);
                add_read_article(h.id);
              }
            },
          },

          [
            m("time", dayjs(h.pubDate).format("DD MMM YYYY")),
            m("h2", clean(h.title)),
          ]
        );
      })
    );
  },
};

var article = {
  view: function () {
    return m(
      "div",
      {
        id: "article",
        oncreate: () => {
          bottom_bar(
            "<img src='assets/icons/list.svg'>",
            "",
            "<img src='assets/icons/option.svg'>"
          );
        },
      },
      articles.map((h, i) => {
        var index = m.route.param("index");
        if (index != i) return;

        // Check if the article has an audio enclosure
        const hasAudio =
          h.enclosure &&
          h.enclosure.type &&
          h.enclosure.type.startsWith("audio");

        const hasVideo =
          h.enclosure &&
          h.enclosure.type &&
          h.enclosure.type.startsWith("video");

        return m(
          "article",
          {
            class: "item",
            tabindex: 0, // Make the article focusable
            oncreate: (vnode) => {
              vnode.dom.focus();
            },

            onkeydown: (e) => {
              if (e.key === "Backspace") {
                m.route.set("/start/?index=" + index);
              }
              if (e.key === "Enter") {
                if (hasAudio) {
                  m.route.set(
                    `/AudioPlayerView?url=${encodeURIComponent(
                      h.enclosure.url
                    )}`
                  );
                }
                if (hasVideo) {
                  m.route.set(
                    `/VideoPlayerView?url=${encodeURIComponent(
                      h.enclosure.url
                    )}`
                  );
                }
              }
            },
          },
          [
            m("date", dayjs(h.pubDate).format("DD MMM YYYY")),
            m("h2", h.title),
            m("div", clean(h.content)),
          ]
        );
      })
    );
  },
};

var index = {
  view: function () {
    return m(
      "div",
      {
        class: "debug",
        id: "index",
      },
      feed_download_list.map((h, i) => {
        return m(
          "article",
          {
            class: "item",
            tabindex: i,
            oncreate: (vnode) => {
              if (i == 0) vnode.dom.focus();
            },
          },
          [m("h2", h.title), m("div", h.amount)]
        );
      })
    );
  },
};

var scan = {
  view: function (vnode) {
    return m("div");
  },
};

var intro = {
  view: function () {
    return m(
      "div",
      {
        class: "width-100 height-100",
        id: "intro",
        onremove: () => {
          localStorage.setItem("version", status.version);
        },
        oninit: function () {
          setTimeout(function () {
            m.route.set("/start");
          }, 5000);
        },
      },
      [
        m("img", {
          src: "./assets/icons/intro.svg",

          oncreate: () => {
            let get_manifest_callback = (e) => {
              try {
                status.version = e.manifest.version;
                document.querySelector("#version").textContent =
                  e.manifest.version;
              } catch (e) {}

              if ("b2g" in navigator || status.notKaiOS) {
                fetch("/manifest.webmanifest")
                  .then((r) => r.json())
                  .then((parsedResponse) => {
                    status.version = parsedResponse.b2g_features.version;
                  });
              }
            };
            getManifest(get_manifest_callback);
          },
        }),
        m(
          "div",
          {
            class: "flex width-100  justify-content-center ",
            id: "version-box",
          },
          [
            m(
              "kbd",
              {
                id: "version",
              },
              localStorage.getItem("version") || 0
            ),
          ]
        ),
      ]
    );
  },
};

// Format time using dayjs
const formatTime = (seconds) => {
  return dayjs.duration(seconds, "seconds").format("mm:ss");
};

// VideoPlayerView definition
const VideoPlayerView = {
  videoElement: null, // Store video element
  videoDuration: 0, // Store video duration
  currentTime: 0, // Store current time of the video
  isPlaying: false, // Track play state
  seekAmount: 5, // Seek by 5 seconds

  oncreate: ({ attrs }) => {
    // Mount the video element to the DOM when the component is created
    VideoPlayerView.videoElement = document.createElement("video");
    const videoContainer = document.getElementById("video-container");
    videoContainer.appendChild(VideoPlayerView.videoElement);

    // Load the video URL from the route parameter
    const videoUrl = attrs.url;
    if (videoUrl) {
      VideoPlayerView.videoElement.src = videoUrl;
      VideoPlayerView.videoElement.play();
      VideoPlayerView.isPlaying = true;
    }

    // Set up an event listener to capture the duration and update progress
    VideoPlayerView.videoElement.onloadedmetadata = () => {
      VideoPlayerView.videoDuration = VideoPlayerView.videoElement.duration;
      m.redraw(); // Force a redraw to update the UI with the duration
    };

    // Update the current time and redraw progress bar as video plays
    VideoPlayerView.videoElement.ontimeupdate = () => {
      VideoPlayerView.currentTime = VideoPlayerView.videoElement.currentTime;
      m.redraw(); // Update UI with the current time and progress
    };

    // Activate local controls with keyboard events
    document.addEventListener("keydown", VideoPlayerView.handleKeydown);
  },

  onremove: () => {
    // Remove the keydown listener when the view is removed
    document.removeEventListener("keydown", VideoPlayerView.handleKeydown);
  },

  handleKeydown: (e) => {
    if (e.key === "Enter") {
      VideoPlayerView.togglePlayPause();
    } else if (e.key === "ArrowLeft") {
      VideoPlayerView.seek("left");
    } else if (e.key === "ArrowRight") {
      VideoPlayerView.seek("right");
    }
  },

  togglePlayPause: () => {
    if (VideoPlayerView.isPlaying) {
      VideoPlayerView.videoElement.pause();
    } else {
      VideoPlayerView.videoElement.play();
    }
    VideoPlayerView.isPlaying = !VideoPlayerView.isPlaying;
  },

  seek: (direction) => {
    const currentTime = VideoPlayerView.videoElement.currentTime;
    if (direction === "left") {
      VideoPlayerView.videoElement.currentTime = Math.max(
        0,
        currentTime - VideoPlayerView.seekAmount
      );
    } else if (direction === "right") {
      VideoPlayerView.videoElement.currentTime = Math.min(
        VideoPlayerView.videoDuration,
        currentTime + VideoPlayerView.seekAmount
      );
    }
  },

  view: ({ attrs }) => {
    // Calculate progress as a percentage
    const progressPercent =
      VideoPlayerView.videoDuration > 0
        ? (VideoPlayerView.currentTime / VideoPlayerView.videoDuration) * 100
        : 0;

    return m("div", { class: "video-player" }, [
      m("div", { id: "video-container", class: "video-container" }), // Video element will be mounted here

      m("div", { class: "controls" }, [
        m(
          "button",
          { onclick: VideoPlayerView.togglePlayPause },
          VideoPlayerView.isPlaying ? "Pause" : "Play"
        ),
        m(
          "button",
          { onclick: () => VideoPlayerView.seek("left") },
          "Seek Backward"
        ),
        m(
          "button",
          { onclick: () => VideoPlayerView.seek("right") },
          "Seek Forward"
        ),
      ]),

      m("div", { class: "video-info" }, [
        ` ${formatTime(VideoPlayerView.currentTime)} / ${formatTime(
          VideoPlayerView.videoDuration
        )}`,
      ]),

      // Progress bar container
      m("div", { class: "progress-bar-container" }, [
        m("div", {
          class: "progress-bar",
          style: { width: `${progressPercent}%` },
        }),
      ]),
    ]);
  },
};

// Define the audio element globally
const globalAudioElement = document.createElement("audio");
globalAudioElement.preload = "auto"; // Load audio automatically

const AudioPlayerView = {
  audioDuration: 0, // Store audio duration
  currentTime: 0, // Store current time of the audio
  isPlaying: false, // Track play state
  seekAmount: 5, // Seek by 5 seconds

  oninit: ({ attrs }) => {
    // Load the audio URL if it changes
    if (attrs.url && globalAudioElement.src !== attrs.url) {
      globalAudioElement.src = attrs.url;
      globalAudioElement.play().catch(() => {}); // Handle play promise rejection
      AudioPlayerView.isPlaying = true;
    }

    // Set up event listeners
    globalAudioElement.onloadedmetadata = () => {
      AudioPlayerView.audioDuration = globalAudioElement.duration;
      m.redraw(); // Force a redraw to update the UI with the duration
    };

    globalAudioElement.ontimeupdate = () => {
      AudioPlayerView.currentTime = globalAudioElement.currentTime;
      m.redraw(); // Update UI with the current time and progress
    };

    // Restore play/pause state
    AudioPlayerView.isPlaying = !globalAudioElement.paused;

    // Activate local controls with keyboard events
    document.addEventListener("keydown", AudioPlayerView.handleKeydown);
  },

  onremove: () => {
    // Remove the keydown listener when the view is removed
    document.removeEventListener("keydown", AudioPlayerView.handleKeydown);
  },

  handleKeydown: (e) => {
    if (e.key === "Enter") {
      AudioPlayerView.togglePlayPause();
    } else if (e.key === "ArrowLeft") {
      AudioPlayerView.seek("left");
    } else if (e.key === "ArrowRight") {
      AudioPlayerView.seek("right");
    }
  },

  togglePlayPause: () => {
    if (AudioPlayerView.isPlaying) {
      globalAudioElement.pause();
    } else {
      globalAudioElement.play().catch(() => {}); // Handle play promise rejection
    }
    AudioPlayerView.isPlaying = !AudioPlayerView.isPlaying;
  },

  seek: (direction) => {
    const currentTime = globalAudioElement.currentTime;
    if (direction === "left") {
      globalAudioElement.currentTime = Math.max(
        0,
        currentTime - AudioPlayerView.seekAmount
      );
    } else if (direction === "right") {
      globalAudioElement.currentTime = Math.min(
        AudioPlayerView.audioDuration,
        currentTime + AudioPlayerView.seekAmount
      );
    }
  },

  view: ({ attrs }) => {
    // Calculate progress as a percentage
    const progressPercent =
      AudioPlayerView.audioDuration > 0
        ? (AudioPlayerView.currentTime / AudioPlayerView.audioDuration) * 100
        : 0;

    return m("div", { class: "audio-player" }, [
      m("div", { id: "audio-container", class: "audio-container" }), // Audio element will be mounted here

      m("div", { class: "controls" }, [
        m(
          "button",
          { onclick: AudioPlayerView.togglePlayPause },
          AudioPlayerView.isPlaying ? "Pause" : "Play"
        ),
        m(
          "button",
          { onclick: () => AudioPlayerView.seek("left") },
          "Seek Backward"
        ),
        m(
          "button",
          { onclick: () => AudioPlayerView.seek("right") },
          "Seek Forward"
        ),
      ]),

      m("div", { class: "audio-info" }, [
        `Current Time: ${formatTime(
          AudioPlayerView.currentTime
        )} / ${formatTime(AudioPlayerView.audioDuration)}`,
      ]),

      // Progress bar container
      m("div", { class: "progress-bar-container" }, [
        m("div", {
          class: "progress-bar",
          style: { width: `${progressPercent}%` },
        }),
      ]),
    ]);
  },
};

m.route(root, "/intro", {
  "/intro": intro,
  "/start": start,
  "/options": options,
  "/scan": scan,
  "/about": about,
  "/article": article,
  "/index": index,
  "/AudioPlayerView": AudioPlayerView,
  "/VideoPlayerView": VideoPlayerView,
});

function scrollToCenter() {
  const activeElement = document.activeElement;
  if (!activeElement) return;

  const rect = activeElement.getBoundingClientRect();
  let elY = rect.top + rect.height / 2;

  let scrollContainer = activeElement.parentNode;

  // Find the first scrollable parent
  while (scrollContainer) {
    if (
      scrollContainer.scrollHeight > scrollContainer.clientHeight ||
      scrollContainer.scrollWidth > scrollContainer.clientWidth
    ) {
      // Calculate the element's offset relative to the scrollable parent
      const containerRect = scrollContainer.getBoundingClientRect();
      elY = rect.top - containerRect.top + rect.height / 2;
      break;
    }
    scrollContainer = scrollContainer.parentNode;
  }

  if (scrollContainer) {
    scrollContainer.scrollBy({
      left: 0,
      top: elY - scrollContainer.clientHeight / 2,
      behavior: "smooth",
    });
  } else {
    // If no scrollable parent is found, scroll the document body
    document.body.scrollBy({
      left: 0,
      top: elY - window.innerHeight / 2,
      behavior: "smooth",
    });
  }
}

document.addEventListener("DOMContentLoaded", function (e) {
  /////////////////
  ///NAVIGATION
  /////////////////

  let nav = function (move) {
    if (
      document.activeElement.nodeName == "SELECT" ||
      document.activeElement.type == "date" ||
      document.activeElement.type == "time"
    )
      return false;

    if (document.activeElement.classList.contains("scroll")) {
      const scrollableElement = document.querySelector(".scroll");
      if (move == 1) {
        scrollableElement.scrollBy({ left: 0, top: 10 });
      } else {
        scrollableElement.scrollBy({ left: 0, top: -10 });
      }
    }

    const currentIndex = document.activeElement.tabIndex;
    let next = currentIndex + move;
    let items = 0;

    items = document.getElementById("app").querySelectorAll(".item");

    if (document.activeElement.parentNode.classList.contains("input-parent")) {
      document.activeElement.parentNode.focus();
      return true;
    }

    let targetElement = 0;

    if (next <= items.length) {
      targetElement = items[next];
      targetElement.focus();
    }

    if (next >= items.length) {
      targetElement = items[0];
      targetElement.focus();
    }

    scrollToCenter();
  };

  // Add click listeners to simulate key events
  document
    .querySelector("div.button-left")
    .addEventListener("click", function (event) {
      simulateKeyPress("SoftLeft");
    });

  document
    .querySelector("div.button-right")
    .addEventListener("click", function (event) {
      simulateKeyPress("SoftRight");
    });

  document
    .querySelector("div.button-center")
    .addEventListener("click", function (event) {
      simulateKeyPress("Enter");
    });

  //top bar

  document
    .querySelector("#top-bar div div.button-right")
    .addEventListener("click", function (event) {});

  // Function to simulate key press events
  function simulateKeyPress(k) {
    shortpress_action({ key: k });
  }

  // Add an event listener for keydown events
  document.addEventListener("keydown", function (event) {
    handleKeyDown(event);
  });

  // Add an event listener for keydown events
  document.addEventListener("keyup", function (event) {
    handleKeyUp(event);
  });

  // ////////////////////////////
  // //KEYPAD HANDLER////////////
  // ////////////////////////////

  let longpress = false;
  const longpress_timespan = 2000;
  let timeout;

  function repeat_action(param) {
    switch (param.key) {
    }
  }

  //////////////
  ////LONGPRESS
  /////////////
  let users_geolocation_count = 0;

  function longpress_action(param) {
    let route = m.route.get();

    switch (param.key) {
      case "Backspace":
        window.close();
        break;

      case "Enter":
        break;
    }
  }

  // /////////////
  // //SHORTPRESS
  // ////////////

  function shortpress_action(param) {
    let r = m.route.get();

    switch (param.key) {
      case "ArrowRight":
        break;

      case "ArrowLeft":
        break;
      case "ArrowUp":
        nav(-1);
        break;
      case "ArrowDown":
        nav(+1);

        break;

      case "SoftRight":
      case "Alt":
        break;

      case "SoftLeft":
      case "Control":
        if (r.startsWith("/start")) {
          m.route.set("/index");
        }
        break;

      case "Enter":
        break;

      case "*":
        m.route.set(`/AudioPlayerView`);
        break;

      case "Backspace":
        if (r.startsWith("/article")) {
          // m.route.set("/start");
        }

        if (r.startsWith("/index")) {
          m.route.set("/start");
        }

        if (r.startsWith("/Video")) {
          history.back();
        }

        if (r.startsWith("/Audio")) history.back(); // Navigate back in history

        break;
    }
  }

  // ///////////////////////////////
  // //shortpress / longpress logic
  // //////////////////////////////

  function handleKeyDown(evt) {
    let route = m.route.get();

    if (evt.key === "EndCall") {
      evt.preventDefault();
      if (status.action == "") {
        closeAllConnections();
        peer.destroy();
        window.close();
      }
    }
    if (!evt.repeat) {
      longpress = false;
      timeout = setTimeout(() => {
        longpress = true;
        longpress_action(evt);
      }, longpress_timespan);
    }

    if (evt.repeat) {
      if (evt.key == "Backspace") longpress = false;

      repeat_action(evt);
    }
  }

  function handleKeyUp(evt) {
    if (status.audio_recording === true) {
    }

    if (status.visibility === false) return false;

    clearTimeout(timeout);
    if (!longpress) {
      shortpress_action(evt);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      status.visibility = true;
    } else {
      status.visibility = false;
    }
  });
});

window.addEventListener("online", () => {
  status.deviceOnline = true;
});
window.addEventListener("offline", () => {
  status.deviceOnline = false;
});

//webActivity KaiOS 3

try {
  navigator.serviceWorker
    .register(new URL("sw.js", import.meta.url), {
      type: "module",
    })
    .then((registration) => {
      if (registration.waiting) {
        // There's a new service worker waiting to activate
        // You can prompt the user to reload the page to apply the update
        // For example: show a message to the user
      } else {
        // No waiting service worker, registration was successful
      }

      registration.systemMessageManager.subscribe("activity").then(
        (rv) => {
          console.log(rv);
        },
        (error) => {
          console.log(error);
        }
      );
    });
} catch (e) {
  console.log(e);
}
