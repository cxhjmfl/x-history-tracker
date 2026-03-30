// X时间线记录器 - 后台脚本
console.log('[X记录器后台] 启动');

// 初始化存储
chrome.runtime.onInstalled.addListener(() => {
  console.log('[X记录器后台] 初始化存储');
  chrome.storage.local.set({
    sessions: [],
    tweets: {},
    stats: {
      totalTweetsRecorded: 0,
      forYouCount: 0,
      followingCount: 0,
      totalTimeSpent: 0,
      averageSessionDuration: 0,
      interactionCounts: { likes: 0, retweets: 0, replies: 0, bookmarks: 0 }
    },
    algorithmAnalysis: {
      promotedContent: 0,
      contentTypes: { text: 0, image: 0, video: 0, card: 0 },
      timelinePosition: { promotedPositions: [], averagePromotedPosition: 0 },
      authorFrequency: {},
      hashtagTrends: {}
    }
  });
});

// 活跃会话
const activeSessions = new Map();

// 消息处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[X记录器后台] 收到消息:', message.type);
  
  handleMessage(message).then(result => {
    sendResponse(result);
  }).catch(err => {
    console.error('[X记录器后台] 错误:', err);
    sendResponse({ error: err.message });
  });
  
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case 'new_tweet':
      return await handleNewTweet(message.data, message.sessionId);
    case 'session_sync':
      return await handleSessionSync(message.data);
    case 'session_end':
      return await handleSessionEnd(message.data);
    case 'interaction':
      return await handleInteraction(message.data, message.sessionId);
    case 'get_stats':
      return await getStats();
    case 'get_history':
      return await getHistory(message.limit || 100, message.timelineType, message.startDate, message.endDate);
    case 'get_timeline_analysis':
      return await getTimelineAnalysis();
    case 'clear_data':
      return await clearData();
    case 'inject_script':
      if (message.tabId) {
        await injectContentScript(message.tabId);
      }
      return { success: true };
    default:
      return { error: '未知类型: ' + message.type };
  }
}

async function handleNewTweet(tweetData, sessionId) {
  const data = await chrome.storage.local.get(['tweets', 'stats', 'algorithmAnalysis']);
  
  // 追踪活跃会话
  if (!activeSessions.has(sessionId)) {
    activeSessions.set(sessionId, { id: sessionId, tweets: [], startTime: Date.now() });
  }
  const session = activeSessions.get(sessionId);
  session.tweets.push(tweetData);
  session.lastUpdate = Date.now();

  // 如果是新推文
  if (!data.tweets[tweetData.id]) {
    data.tweets[tweetData.id] = { ...tweetData, sessions: [sessionId], viewCount: 1 };
    
    // 更新统计
    data.stats.totalTweetsRecorded++;
    if (tweetData.timelineType === 'for-you') {
      data.stats.forYouCount++;
    } else {
      data.stats.followingCount++;
    }
    
    // 更新算法分析
    const mediaType = tweetData.mediaType || 'text';
    data.algorithmAnalysis.contentTypes[mediaType] = (data.algorithmAnalysis.contentTypes[mediaType] || 0) + 1;
    
    if (tweetData.isPromoted) {
      data.algorithmAnalysis.promotedContent++;
      data.algorithmAnalysis.timelinePosition.promotedPositions.push(tweetData.position);
    }
    
    if (tweetData.authorHandle) {
      data.algorithmAnalysis.authorFrequency[tweetData.authorHandle] = 
        (data.algorithmAnalysis.authorFrequency[tweetData.authorHandle] || 0) + 1;
    }
    
    if (tweetData.hashtags) {
      tweetData.hashtags.forEach(tag => {
        data.algorithmAnalysis.hashtagTrends[tag] = 
          (data.algorithmAnalysis.hashtagTrends[tag] || 0) + 1;
      });
    }
    
    // 计算推广平均位置
    const positions = data.algorithmAnalysis.timelinePosition.promotedPositions;
    if (positions.length > 0) {
      data.algorithmAnalysis.timelinePosition.averagePromotedPosition = 
        positions.reduce((a, b) => a + b, 0) / positions.length;
    }
  } else {
    // 已存在
    data.tweets[tweetData.id].viewCount++;
    if (!data.tweets[tweetData.id].sessions.includes(sessionId)) {
      data.tweets[tweetData.id].sessions.push(sessionId);
    }
  }

  await chrome.storage.local.set({
    tweets: data.tweets,
    stats: data.stats,
    algorithmAnalysis: data.algorithmAnalysis
  });

  return { success: true, recorded: true };
}

async function handleSessionSync(syncData) {
  if (activeSessions.has(syncData.sessionId)) {
    const session = activeSessions.get(syncData.sessionId);
    Object.assign(session, syncData);
    session.lastUpdate = Date.now();
  }
  return { success: true };
}

async function handleSessionEnd(sessionData) {
  const data = await chrome.storage.local.get(['sessions', 'stats']);
  
  const session = {
    id: sessionData.sessionId,
    startTime: sessionData.startTime,
    endTime: Date.now(),
    duration: Date.now() - sessionData.startTime,
    tweetsRecorded: sessionData.tweets?.length || 0,
    timelineType: sessionData.timelineType,
    interactions: sessionData.interactions || []
  };

  data.sessions.push(session);
  if (data.sessions.length > 200) {
    data.sessions = data.sessions.slice(-200);
  }

  data.stats.totalTimeSpent += session.duration;
  data.stats.averageSessionDuration = data.stats.totalTimeSpent / data.sessions.length;

  await chrome.storage.local.set({ sessions: data.sessions, stats: data.stats });
  activeSessions.delete(sessionData.sessionId);
  
  return { success: true };
}

async function handleInteraction(interaction, sessionId) {
  const data = await chrome.storage.local.get(['stats']);
  
  const typeMap = {
    like: 'likes', unlike: 'likes',
    retweet: 'retweets', unretweet: 'retweets',
    reply: 'replies',
    bookmark: 'bookmarks'
  };

  const statType = typeMap[interaction.type];
  if (statType) {
    if (interaction.type.startsWith('un')) {
      data.stats.interactionCounts[statType] = 
        Math.max(0, (data.stats.interactionCounts[statType] || 0) - 1);
    } else {
      data.stats.interactionCounts[statType] = 
        (data.stats.interactionCounts[statType] || 0) + 1;
    }
  }

  await chrome.storage.local.set({ stats: data.stats });
  return { success: true };
}

async function getStats() {
  const data = await chrome.storage.local.get(['stats', 'algorithmAnalysis', 'tweets']);
  
  // 排序作者
  const sortedAuthors = Object.entries(data.algorithmAnalysis?.authorFrequency || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([handle, count]) => ({ handle, count }));

  // 排序话题
  const sortedHashtags = Object.entries(data.algorithmAnalysis?.hashtagTrends || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  return {
    ...data.stats,
    topAuthors: sortedAuthors,
    topHashtags: sortedHashtags,
    algorithmAnalysis: data.algorithmAnalysis,
    totalUniqueTweets: Object.keys(data.tweets || {}).length,
    activeSessions: activeSessions.size
  };
}

async function getHistory(limit, timelineType, startDate, endDate) {
  const data = await chrome.storage.local.get(['sessions', 'tweets']);
  
  let tweets = Object.values(data.tweets || {});
  
  // 时间线类型筛选
  if (timelineType && timelineType !== 'all') {
    tweets = tweets.filter(t => t.timelineType === timelineType);
  }
  
  // 日期筛选
  if (startDate) {
    const start = new Date(startDate).getTime();
    tweets = tweets.filter(t => (t.recordedAt || 0) >= start);
  }
  
  if (endDate) {
    const end = new Date(endDate).getTime();
    tweets = tweets.filter(t => (t.recordedAt || 0) <= end);
  }
  
  // 按时间排序
  tweets.sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0));
  
  // 获取所有日期（用于筛选器）
  const allDates = [...new Set(tweets.map(t => {
    if (t.recordedAt) {
      return new Date(t.recordedAt).toISOString().split('T')[0];
    }
    return t.recordedDate;
  }).filter(Boolean))].sort().reverse();
  
  return {
    sessions: (data.sessions || []).slice(-20),
    tweets: tweets.slice(0, limit),
    timelineType,
    totalCount: tweets.length,
    allDates: allDates.slice(0, 30) // 最近30天
  };
}

async function getTimelineAnalysis() {
  const data = await chrome.storage.local.get(['tweets', 'algorithmAnalysis']);
  const allTweets = Object.values(data.tweets || {});
  
  const forYouTweets = allTweets.filter(t => t.timelineType === 'for-you');
  const followingTweets = allTweets.filter(t => t.timelineType === 'following');

  const analysis = data.algorithmAnalysis || {};
  const promotedCount = analysis.promotedContent || 0;
  
  const features = [];
  
  if (forYouTweets.length > 0) {
    const forYouPromoted = forYouTweets.filter(t => t.isPromoted).length;
    features.push(`"为你推荐"中 ${(forYouPromoted / forYouTweets.length * 100).toFixed(1)}% 是推广内容`);
  }
  
  if (followingTweets.length > 0) {
    const followingPromoted = followingTweets.filter(t => t.isPromoted).length;
    features.push(`"正在关注"中 ${(followingPromoted / followingTweets.length * 100).toFixed(1)}% 是推广内容`);
  }
  
  const avgPos = analysis.timelinePosition?.averagePromotedPosition || 0;
  if (avgPos > 0) {
    features.push(`推广内容平均出现在第 ${avgPos.toFixed(1)} 个位置`);
  }
  
  const contentTypes = analysis.contentTypes || {};
  const total = allTweets.length || 1;
  const videoPercent = ((contentTypes.video || 0) / total * 100).toFixed(1);
  features.push(`视频内容占 ${videoPercent}%（算法偏好多媒体）`);
  
  // 统计回复
  const replyCount = allTweets.filter(t => t.isReply).length;
  if (replyCount > 0) {
    features.push(`时间线中有 ${replyCount} 条回复/对话内容`);
  }

  return {
    forYouCount: forYouTweets.length,
    followingCount: followingTweets.length,
    promotedAnalysis: {
      percentage: allTweets.length > 0 ? (promotedCount / allTweets.length * 100).toFixed(2) : 0,
      averagePosition: avgPos
    },
    contentTypeAnalysis: {
      ...contentTypes,
      total: allTweets.length
    },
    replyCount,
    features,
    authorDiversity: Object.keys(analysis.authorFrequency || {}).length,
    hashtagCount: Object.keys(analysis.hashtagTrends || {}).length
  };
}

async function clearData() {
  await chrome.storage.local.clear();
  activeSessions.clear();
  
  // 重新初始化
  await chrome.storage.local.set({
    sessions: [],
    tweets: {},
    stats: {
      totalTweetsRecorded: 0,
      forYouCount: 0,
      followingCount: 0,
      totalTimeSpent: 0,
      averageSessionDuration: 0,
      interactionCounts: { likes: 0, retweets: 0, replies: 0, bookmarks: 0 }
    },
    algorithmAnalysis: {
      promotedContent: 0,
      contentTypes: { text: 0, image: 0, video: 0, card: 0 },
      timelinePosition: { promotedPositions: [], averagePromotedPosition: 0 },
      authorFrequency: {},
      hashtagTrends: {}
    }
  });
  
  return { success: true };
}

// 程序化注入内容脚本
async function injectContentScript(tabId) {
  try {
    // 检查是否已经注入
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.__xRecorderInjected
    });
    
    if (results && results[0] && results[0].result) {
      console.log('[X记录器后台] 脚本已注入，跳过');
      return;
    }
    
    // 注入标记
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        window.__xRecorderInjected = true;
        console.log('[X记录器后台] 标记已设置');
      }
    });
    
    // 注入内容脚本
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    
    console.log('[X记录器后台] 内容脚本已注入到标签页:', tabId);
  } catch (err) {
    console.error('[X记录器后台] 注入失败:', err);
  }
}

// 监听标签页更新
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    if (tab.url.includes('x.com') || tab.url.includes('twitter.com')) {
      console.log('[X记录器后台] 检测到X页面，准备注入脚本:', tab.url);
      // 延迟一下确保页面稳定
      setTimeout(() => injectContentScript(tabId), 1000);
    }
  }
});

// 清理过期会话
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeSessions.entries()) {
    if (session.lastUpdate && (now - session.lastUpdate > 30 * 60 * 1000)) {
      activeSessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

console.log('[X记录器后台] 启动完成');
