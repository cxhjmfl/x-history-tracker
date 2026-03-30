// X为你推荐时间线记录器 - 内容脚本 v2.4
// 自动记录所有出现在时间线上的推文
// 兼容版 - 使用传统函数语法

(function() {
  'use strict';

  // 立即输出日志，确认脚本已加载
  console.log('[X记录器 v2.4] ================================');
  console.log('[X记录器 v2.4] 内容脚本已加载');
  console.log('[X记录器] 当前URL:', window.location.href);
  console.log('[X记录器] 页面状态:', document.readyState);
  console.log('[X记录器 v2.4] ================================');

  // 会话数据
  var sessionData = {
    sessionId: 'session_' + Date.now(),
    startTime: Date.now(),
    timelineType: 'for-you',
    tweets: [],
    interactions: [],
    scrollPosition: 0
  };

  // 已记录的推文ID
  var recordedIds = new Set();
  var tweetPosition = 0;
  var isRecording = false;
  var observer = null;

  // 检测时间线类型
  function getTimelineType() {
    var url = window.location.href;
    if (url.indexOf('/following') !== -1) return 'following';
    return 'for-you';
  }

  // 提取推文ID - 2024年X.com最新适配
  function getTweetId(element) {
    if (!element) return null;
    
    // 方法1: 直接查找所有包含/status/的链接
    var statusLinks = element.querySelectorAll('a[href*="/status/"]');
    
    for (var i = 0; i < statusLinks.length; i++) {
      var link = statusLinks[i];
      var href = link.getAttribute('href') || '';
      // X.com链接格式: /username/status/1234567890
      var match = href.match(/\/status\/(\d+)/);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    // 方法2: 如果元素本身是链接
    if (element.tagName === 'A') {
      var href2 = element.getAttribute('href') || '';
      var match2 = href2.match(/\/status\/(\d+)/);
      if (match2 && match2[1]) {
        return match2[1];
      }
    }
    
    // 方法3: 从时间戳链接（X.com常见结构）
    var timeLink = element.querySelector('a time');
    if (timeLink) {
      var link2 = timeLink.closest('a');
      if (link2) {
        var href3 = link2.getAttribute('href') || '';
        var match3 = href3.match(/\/status\/(\d+)/);
        if (match3 && match3[1]) {
          return match3[1];
        }
      }
    }
    
    // 方法4: 遍历所有a标签（兜底方案）
    var allLinks = element.getElementsByTagName('a');
    for (var j = 0; j < allLinks.length; j++) {
      var href4 = allLinks[j].getAttribute('href') || '';
      if (href4.indexOf('/status/') !== -1) {
        var match4 = href4.match(/status\/(\d+)/);
        if (match4 && match4[1] && match4[1].length >= 10) {
          return match4[1];
        }
      }
    }
    
    return null;
  }

  // 提取作者 - 2024年X.com最新适配
  function getAuthor(element) {
    // 方法1: 从status链接反向找到作者
    var statusLinks = element.querySelectorAll('a[href*="/status/"]');
    for (var i = 0; i < statusLinks.length; i++) {
      var href = statusLinks[i].getAttribute('href') || '';
      // 格式: /username/status/123456
      var match = href.match(/^\/(\w+)\/status\/\d+/);
      if (match && match[1]) {
        var username = match[1];
        var reserved = ['i', 'settings', 'explore', 'notifications', 'messages', 'home', 'search', 'compose'];
        if (reserved.indexOf(username.toLowerCase()) === -1) {
          return username;
        }
      }
    }
    
    // 方法2: User-Name testid
    var userNameEl = element.querySelector('[data-testid="User-Name"]');
    if (userNameEl) {
      var links = userNameEl.querySelectorAll('a');
      for (var j = 0; j < links.length; j++) {
        var href2 = links[j].getAttribute('href') || '';
        if (href2.charAt(0) === '/' && href2.indexOf('/status/') === -1) {
          var match2 = href2.match(/^\/(\w+)$/);
          if (match2 && match2[1] && match2[1].length > 1) {
            return match2[1];
          }
        }
      }
      // 从文本中提取
      var text = userNameEl.textContent || '';
      var match3 = text.match(/@(\w+)/);
      if (match3) return match3[1];
    }
    
    // 方法3: 查找作者链接（排除status链接）
    var allLinks = element.querySelectorAll('a[href^="/"]');
    for (var k = 0; k < allLinks.length; k++) {
      var href3 = allLinks[k].getAttribute('href') || '';
      // 必须是 /username 格式，不能包含/status/
      if (href3.indexOf('/status/') === -1 && href3.indexOf('?') === -1) {
        var match4 = href3.match(/^\/(\w{2,})$/);
        if (match4) {
          var username2 = match4[1];
          var reserved2 = ['i', 'settings', 'explore', 'notifications', 'messages', 'home', 'search', 'compose', 'intent'];
          if (reserved2.indexOf(username2.toLowerCase()) === -1) {
            return username2;
          }
        }
      }
    }
    
    // 方法4: 从aria-label属性中提取
    var withAriaLabel = element.querySelectorAll('[aria-label]');
    for (var m = 0; m < withAriaLabel.length; m++) {
      var label = withAriaLabel[m].getAttribute('aria-label') || '';
      var match5 = label.match(/@(\w+)/);
      if (match5) return match5[1];
    }
    
    return 'unknown';
  }

  // 提取内容
  function getContent(element) {
    var textEl = element.querySelector('[data-testid="tweetText"]');
    if (textEl) {
      return textEl.textContent.trim().substring(0, 500);
    }
    return '';
  }

  // 提取互动数
  function getCount(element, testId) {
    var el = element.querySelector('[data-testid="' + testId + '"]');
    if (!el) return 0;
    
    var text = el.textContent || '';
    var num = text.replace(/,/g, '').match(/([\d.]+)([KM]?)/i);
    
    if (num) {
      var val = parseFloat(num[1]);
      var suffix = num[2] ? num[2].toUpperCase() : '';
      if (suffix === 'K') val *= 1000;
      if (suffix === 'M') val *= 1000000;
      return Math.round(val);
    }
    
    return 0;
  }

  // 检查是否推广
  function isPromoted(element) {
    var text = element.textContent || '';
    return text.indexOf('推广') !== -1 || 
           text.indexOf('Promoted') !== -1 ||
           text.indexOf('广告') !== -1 ||
           element.querySelector('[data-testid="promoted-tweet"]') !== null;
  }

  // 检查媒体类型
  function getMediaType(element) {
    if (element.querySelector('[data-testid="videoPlayer"]') || 
        element.querySelector('video')) return 'video';
    if (element.querySelector('[data-testid="tweetPhoto"]') ||
        element.querySelector('img[alt*="Image"]')) return 'image';
    if (element.querySelector('[data-testid="card.wrapper"]') ||
        element.querySelector('a[href*="card"]')) return 'card';
    return 'text';
  }

  // 检查是否回复
  function isReply(element) {
    var socialContext = element.querySelector('[data-testid="socialContext"]');
    if (socialContext) {
      var text = socialContext.textContent || '';
      return text.indexOf('回复') !== -1 || text.indexOf('Replying') !== -1;
    }
    return false;
  }

  // 提取话题标签
  function getHashtags(element) {
    var tags = [];
    var hashtagLinks = element.querySelectorAll('a[href*="/hashtag/"]');
    for (var i = 0; i < hashtagLinks.length; i++) {
      var href = hashtagLinks[i].getAttribute('href') || '';
      var match = href.match(/hashtag\/([^?/]+)/);
      if (match) {
        tags.push(decodeURIComponent(match[1]));
      }
    }
    // 去重
    return tags.filter(function(item, index) {
      return tags.indexOf(item) === index;
    });
  }

  // 记录推文
  function recordTweet(element) {
    try {
      // 获取推文ID
      var tweetId = getTweetId(element);
      if (!tweetId) {
        return false;
      }
      
      // 检查是否已记录
      if (recordedIds.has(tweetId)) {
        return false;
      }

      // 获取作者
      var authorHandle = getAuthor(element);
      
      // 即使作者是unknown也记录，至少能捕获推文ID
      return doRecord(element, tweetId, authorHandle);
    } catch (e) {
      console.error('[X记录器] 记录失败:', e);
      return false;
    }
  }

  // 实际记录函数
  function doRecord(element, tweetId, authorHandle) {
    tweetPosition++;
    recordedIds.add(tweetId);

    var tweetData = {
      id: tweetId,
      position: tweetPosition,
      authorHandle: authorHandle,
      content: getContent(element),
      likes: getCount(element, 'like'),
      retweets: getCount(element, 'retweet'),
      replies: getCount(element, 'reply'),
      isPromoted: isPromoted(element),
      mediaType: getMediaType(element),
      isReply: isReply(element),
      hashtags: getHashtags(element),
      timelineType: getTimelineType(),
      recordedAt: Date.now(),
      recordedDate: new Date().toISOString().split('T')[0]
    };

    sessionData.tweets.push(tweetData);
    
    console.log('[X记录器] ✓ #' + tweetPosition + ' @' + tweetData.authorHandle + (tweetData.isPromoted ? ' [推广]' : ''));

    // 发送给后台
    try {
      chrome.runtime.sendMessage({
        type: 'new_tweet',
        data: tweetData,
        sessionId: sessionData.sessionId
      }).then(function() {
        console.log('[X记录器] 已保存到后台: ' + tweetId);
      }).catch(function(err) {
        // 检查是否是扩展上下文失效
        if (err.message && err.message.includes('Extension context invalidated')) {
          console.log('[X记录器] 扩展已更新，记录暂停');
          isRecording = false;
          return;
        }
        console.error('[X记录器] 保存失败:', err);
      });
    } catch (e) {
      // 同步错误（如扩展上下文失效）
      if (e.message && e.message.includes('Extension context invalidated')) {
        console.log('[X记录器] 扩展已更新，记录暂停');
        isRecording = false;
      } else {
        console.error('[X记录器] 发送消息失败:', e);
      }
    }

    return true;
  }

  // 扫描推文 - 2024年X.com最新适配
  function scanTweets() {
    if (!isRecording) {
      return;
    }
    
    var found = 0;
    var scanned = 0;
    
    // 主要方法：查找所有article元素（X.com使用article标签）
    var articles = document.querySelectorAll('article');
    
    if (articles.length > 0) {
      for (var i = 0; i < articles.length; i++) {
        scanned++;
        if (recordTweet(articles[i])) {
          found++;
        }
      }
    } else {
      // 备用方法1: 查找包含推文的div（X.com的另一种结构）
      var tweetDivs = document.querySelectorAll('[data-testid="cellInnerDiv"]');
      
      if (tweetDivs.length > 0) {
        for (var j = 0; j < tweetDivs.length; j++) {
          var article = tweetDivs[j].querySelector('article');
          if (article) {
            scanned++;
            if (recordTweet(article)) {
              found++;
            }
          }
        }
      }
    }

    // 每10秒输出一次统计信息
    var now = Date.now();
    if (!window._lastScanLog || now - window._lastScanLog > 10000) {
      console.log('[X记录器] 扫描统计: 已扫描=' + scanned + ', 新记录=' + found + ', 总计=' + sessionData.tweets.length);
      window._lastScanLog = now;
    }
    
    // 如果运行了30秒还没有记录，输出调试信息
    if (isRecording && sessionData.tweets.length === 0) {
      var runTime = Date.now() - sessionData.startTime;
      if (runTime > 30000 && (!window._debugLogged || now - window._debugLogged > 30000)) {
        console.log('[X记录器] 调试信息 - 运行时间:', Math.floor(runTime/1000), '秒');
        console.log('[X记录器] 当前页面:', window.location.href);
        console.log('[X记录器] article元素数量:', document.querySelectorAll('article').length);
        console.log('[X记录器] 页面是否加载完成:', document.readyState);
        console.log('[X记录器] 建议: 请确保你正在浏览 x.com 主页的时间线');
        window._debugLogged = now;
      }
    }
  }

  // 启动记录
  function startRecording() {
    if (isRecording) {
      console.log('[X记录器] 已经在记录中');
      return;
    }
    
    console.log('[X记录器] 开始记录');
    isRecording = true;
    
    // 立即扫描一次
    console.log('[X记录器] 首次扫描...');
    scanTweets();
    
    // 创建观察器
    if (observer) {
      observer.disconnect();
    }
    
    observer = new MutationObserver(function(mutations) {
      var hasNewNodes = false;
      
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        for (var j = 0; j < mutation.addedNodes.length; j++) {
          var node = mutation.addedNodes[j];
          if (node.nodeType === Node.ELEMENT_NODE) {
            // 检查是否是article或包含article，或者是推文相关元素
            if (node.tagName === 'ARTICLE' || 
                (node.querySelector && node.querySelector('article')) ||
                (node.querySelector && node.querySelector('a[href*="/status/"]'))) {
              hasNewNodes = true;
            }
          }
        }
      }

      if (hasNewNodes) {
        // 延迟扫描，等待DOM稳定
        setTimeout(scanTweets, 300);
      }
    });
    
    // 观察整个文档
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
      console.log('[X记录器] 观察器已启动');
    } else {
      console.log('[X记录器] 等待body加载...');
      setTimeout(startRecording, 500);
      return;
    }
    
    // 定期扫描作为备份（每3秒）
    setInterval(function() {
      if (isRecording) {
        scanTweets();
      }
    }, 3000);
    
    console.log('[X记录器] 记录系统完全启动');
  }

  // 监听URL变化（X是SPA）
  var lastUrl = location.href;
  setInterval(function() {
    if (location.href !== lastUrl) {
      console.log('[X记录器] URL变化:', location.href);
      lastUrl = location.href;
      
      // 延迟后扫描
      setTimeout(scanTweets, 1000);
    }
  }, 1000);

  // 监听滚动
  var scrollTimeout;
  window.addEventListener('scroll', function() {
    sessionData.scrollPosition = window.scrollY;
    
    // 滚动停止后扫描
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(function() {
      scanTweets();
    }, 300);
  });

  // 监听互动
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-testid]');
    if (!btn) return;

    var testId = btn.dataset.testid;
    var tweetEl = btn.closest('article');
    
    if (tweetEl && ['like', 'unlike', 'retweet', 'unretweet', 'reply', 'bookmark'].indexOf(testId) !== -1) {
      var tweetId = getTweetId(tweetEl);
      if (tweetId) {
        sessionData.interactions.push({
          type: testId,
          tweetId: tweetId,
          timestamp: Date.now()
        });
        
        try {
          chrome.runtime.sendMessage({
            type: 'interaction',
            data: { type: testId, tweetId: tweetId, timestamp: Date.now() },
            sessionId: sessionData.sessionId
          }).catch(function(err) {
            if (err && err.message && err.message.includes('Extension context invalidated')) {
              console.log('[X记录器] 扩展已更新，停止互动记录');
              isRecording = false;
            }
          });
        } catch (e) {
          if (e.message && e.message.includes('Extension context invalidated')) {
            console.log('[X记录器] 扩展已更新，停止互动记录');
            isRecording = false;
          }
        }
      }
    }
  });

  // 定期同步会话
  setInterval(function() {
    if (sessionData.tweets.length > 0 && isRecording) {
      try {
        chrome.runtime.sendMessage({
          type: 'session_sync',
          data: {
            sessionId: sessionData.sessionId,
            timelineType: getTimelineType(),
            tweetCount: sessionData.tweets.length
          }
        }).catch(function(err) {
          if (err && err.message && err.message.includes('Extension context invalidated')) {
            console.log('[X记录器] 扩展已更新，停止同步');
            isRecording = false;
          }
        });
      } catch (e) {
        if (e.message && e.message.includes('Extension context invalidated')) {
          console.log('[X记录器] 扩展已更新，停止同步');
          isRecording = false;
        }
      }
    }
  }, 10000);

  // 页面卸载
  window.addEventListener('beforeunload', function() {
    if (sessionData.tweets.length > 0) {
      try {
        chrome.runtime.sendMessage({
          type: 'session_end',
          data: sessionData
        }).catch(function(err) {
          // 忽略错误
          if (err && err.message && err.message.includes('Extension context invalidated')) {
            // 扩展已更新，忽略
          }
        });
      } catch (e) {
        // 同步错误，忽略
      }
    }
  });

  // 启动逻辑
  function init() {
    console.log('[X记录器] 初始化...');
    console.log('[X记录器] 当前页面:', window.location.href);
    
    // 检查是否在X上（包括主页、搜索页等）
    var isX = location.href.indexOf('x.com') !== -1 || location.href.indexOf('twitter.com') !== -1;
    console.log('[X记录器] 是否在X页面:', isX);
    
    if (!isX) {
      console.log('[X记录器] 不在X页面，等待...');
      return;
    }
    
    // X.com需要时间线内容加载，不断尝试启动
    function tryStart() {
      // 检查页面是否有推文元素
      var hasArticles = document.querySelectorAll('article').length > 0;
      var hasStatusLinks = document.querySelectorAll('a[href*="/status/"]').length > 0;
      
      console.log('[X记录器] 检查页面状态:', { hasArticles: hasArticles, hasStatusLinks: hasStatusLinks });
      
      if (hasArticles || hasStatusLinks) {
        console.log('[X记录器] 检测到推文内容，启动记录');
        startRecording();
        return true;
      }
      return false;
    }
    
    // 立即尝试
    if (!tryStart()) {
      console.log('[X记录器] 页面内容未就绪，等待...');
    }
    
    // 页面加载事件
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        console.log('[X记录器] DOMContentLoaded');
        tryStart();
      });
    }
    
    // 多次尝试启动（X是SPA，内容动态加载）
    var delays = [2000, 5000, 10000, 15000, 20000];
    for (var i = 0; i < delays.length; i++) {
      (function(index, delay) {
        setTimeout(function() {
          if (!isRecording) {
            console.log('[X记录器] 第' + (index + 1) + '次延迟启动尝试...');
            tryStart();
          }
        }, delay);
      })(i, delays[i]);
    }
  }

  // 启动
  init();

  console.log('[X记录器 v2.4] 初始化完成，等待页面内容加载...');
})();
