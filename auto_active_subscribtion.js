/**
 * FlowerCloud (WHMCS) 自动登录、打开订阅开关并同步流量信息 - Sub-Store 脚本操作 (Script Operator)
 *
 * 参考模板：https://raw.githubusercontent.com/xream/scripts/main/surge/modules/sub-store-scripts/sub-info/autoLogin.js
 *
 * ==================== 必看：如何让脚本顺利执行并显示流量信息 ====================
 * 1. 【防跳过设置】：
 *    在单条订阅编辑页，把「本地内容 (Content)」填上一行占位节点：
 *    `placeholder = direct`
 *    （如果完全留空、或远程订阅在开关关闭时拉取失败返回 0 节点，Sub-Store 会直接跳过脚本操作！）
 *
 * 2. 【自动获取流量信息的双重保障】：
 *    - 渠道 A（订阅响应头）：开启开关后，脚本拉取你的现成订阅链接（可通过参数 `subUrl` 传入，也可直接读取单条订阅里的远程链接，或默认使用抓包提取出的 `api.xmancdn.com/osubscribe.php` 原始订阅），读取响应头 `subscription-userinfo`。
 *    - 渠道 B（WHMCS 面板兜底解析）：如果订阅链接用的是第三方 subconverter 转换链接导致丢失了流量响应头，脚本会自动请求 `/clientarea.php?action=productdetails&id=318178`，从页面中解析出【上传 / 下载 / 总流量 / 到期日】并合成标准 `subscription-userinfo` 写入 Sub-Store！
 */

async function operator(proxies = [], targetPlatform, context) {
  const $ = $substore;
  const SUBS_KEY = 'subs';
  const args = typeof $arguments !== 'undefined' && $arguments ? $arguments : {};

  const logInfo = (msg) => {
    console.log(msg);
    if ($ && typeof $.info === 'function') $.info(msg);
  };
  const logError = (msg) => {
    console.error(msg);
    if ($ && typeof $.error === 'function') $.error(msg);
  };

  logInfo(
    `🚀 [FlowerCloud] 开始执行自动登录、开启订阅开关与流量同步脚本 (当前传入节点数: ${proxies.length})`
  );

  // 1. 读取参数（支持 Sub-Store $arguments 传参，未传时使用抓包提取的默认值）
  const api = String(args.api || 'https://api-flowercloud.com').replace(/\/+$/, '');
  const user = args.user || args.username || 'zyx1069958401@gmail.com';
  const password = args.password || 'as159753';
  const serviceId = String(args.serviceId || args.id || '318178');
  const ua =
    args.ua ||
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1';
  const cfClearance = args.cf_clearance || args.cfClearance || '';
  const subUrl = args.subUrl || args.sub_url || '';
  const subUA = args.subUA || args.sub_ua || 'clash.meta';
  const timeout = Number(args.timeout) || 15000;

  // 2. 简易 Cookie 管理器
  const cookieMap = {};
  if (cfClearance) {
    cookieMap['cf_clearance'] = cfClearance;
  }

  function updateCookies(headers) {
    if (!headers) return;
    const rawSetCookie =
      headers['set-cookie'] || headers['Set-Cookie'] || headers['SET-COOKIE'];
    if (!rawSetCookie) return;

    const cookieList = Array.isArray(rawSetCookie)
      ? rawSetCookie
      : String(rawSetCookie).split(/,(?=\s*[A-Za-z0-9_\-%]+=)/);

    for (const item of cookieList) {
      const firstPart = String(item).split(';')[0].trim();
      const eqIdx = firstPart.indexOf('=');
      if (eqIdx > 0) {
        const k = firstPart.slice(0, eqIdx).trim();
        const v = firstPart.slice(eqIdx + 1).trim();
        if (v === 'deleted' || v === '') {
          delete cookieMap[k];
        } else {
          cookieMap[k] = v;
        }
      }
    }
  }

  function getCookieHeader() {
    return Object.entries(cookieMap)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  // 辅助函数：将 "5.43GB" / "63.66MB" 转换为字节数 (Bytes)
  function parseSizeToBytes(sizeStr) {
    if (!sizeStr) return 0;
    const m = String(sizeStr)
      .trim()
      .match(/^([\d.]+)\s*(B|KB|KiB|MB|MiB|GB|GiB|TB|TiB)/i);
    if (!m) return 0;
    const val = parseFloat(m[1]);
    const unit = m[2].toUpperCase();
    const powers = {
      B: 0,
      KB: 1,
      KIB: 1,
      MB: 2,
      MIB: 2,
      GB: 3,
      GIB: 3,
      TB: 4,
      TIB: 4,
    };
    return Math.round(val * Math.pow(1024, powers[unit] ?? 0));
  }

  // 辅助函数：从 WHMCS 产品详情页 HTML 中提取流量与到期时间并生成标准 subscription-userinfo
  function parseUserinfoFromHtml(html) {
    if (!html) return '';
    // 匹配：<p class="usage-amount">5.49GB / 20GB</p>
    const usageMatch = html.match(
      /class=["']usage-amount["'][^>]*>\s*([\d.]+\s*[KMGT]?i?B)\s*\/\s*([\d.]+\s*[KMGT]?i?B)/i
    );
    // 匹配上传：<span class="stat-label">上传</span>...<span class="stat-value">63.66MB</span>
    const upMatch = html.match(
      /上传<\/span>\s*<span[^>]*class=["']stat-value["'][^>]*>\s*([\d.]+\s*[KMGT]?i?B)/i
    );
    // 匹配下载：<span class="stat-label">下载</span>...<span class="stat-value">5.43GB</span>
    const downMatch = html.match(
      /下载<\/span>\s*<span[^>]*class=["']stat-value["'][^>]*>\s*([\d.]+\s*[KMGT]?i?B)/i
    );
    // 匹配到期日：<p class="plan-expires">到期日: 2027/05/11 (年付)</p>
    const expMatch = html.match(/到期日:\s*(\d{4}[/-]\d{1,2}[/-]\d{1,2})/i);

    if (!usageMatch && !upMatch && !downMatch) return '';

    const totalBytes = usageMatch ? parseSizeToBytes(usageMatch[2]) : 0;
    const usedBytes = usageMatch ? parseSizeToBytes(usageMatch[1]) : 0;
    const uploadBytes = upMatch ? parseSizeToBytes(upMatch[1]) : 0;
    const downloadBytes = downMatch
      ? parseSizeToBytes(downMatch[1])
      : Math.max(0, usedBytes - uploadBytes);

    let expireTs = 0;
    if (expMatch && expMatch[1]) {
      const dt = new Date(expMatch[1].replace(/\//g, '-') + 'T23:59:59+08:00');
      if (!isNaN(dt.getTime())) {
        expireTs = Math.floor(dt.getTime() / 1000);
      }
    }

    const parts = [
      `upload=${uploadBytes}`,
      `download=${downloadBytes}`,
      `total=${totalBytes}`,
    ];
    if (expireTs > 0) {
      parts.push(`expire=${expireTs}`);
    }
    return parts.join('; ');
  }

  // 辅助函数：将流量信息和节点内容写回 Sub-Store 数据库与当前响应上下文
  function saveToSubStore(subscriptionUserinfo, rawBody, finalUrl) {
    if (subscriptionUserinfo) {
      if (typeof $options !== 'undefined' && $options) {
        $options._res = $options._res || {};
        $options._res.headers = $options._res.headers || {};
        $options._res.headers['subscription-userinfo'] = subscriptionUserinfo;
      }
      if (context) {
        context._res = context._res || {};
        context._res.headers = context._res.headers || {};
        context._res.headers['subscription-userinfo'] = subscriptionUserinfo;
      }
    }

    const source = context?.source;
    if (source && $.read && $.write) {
      const allSubs = $.read(SUBS_KEY) || [];
      for (const name in source) {
        const sub = source[name];
        if (sub?.name) {
          for (let index = 0; index < allSubs.length; index++) {
            if (sub.name === allSubs[index].name) {
              if (subscriptionUserinfo) {
                allSubs[index].subUserinfo = subscriptionUserinfo;
              }
              if (rawBody) {
                allSubs[index].content = rawBody;
              }
              if (finalUrl && !allSubs[index].url) {
                allSubs[index].url = finalUrl;
              }
              logInfo(
                `💾 [FlowerCloud] 已将流量信息 (${subscriptionUserinfo || '无'}) 写入订阅 [${sub.name}]`
              );
              break;
            }
          }
          break;
        }
      }
      $.write(allSubs, SUBS_KEY);
    }
  }

  const baseHeaders = {
    'user-agent': ua,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'zh-CN,zh-Hans;q=0.9',
  };

  try {
    // ==================== Step 1: 访问登录页获取 CSRF Token 与初始 Cookie ====================
    const clientareaUrl = `${api}/clientarea.php`;
    logInfo(`[FlowerCloud] [1/4] 请求登录页获取 CSRF Token: ${clientareaUrl}`);

    const pageRes = await $.http.get({
      url: clientareaUrl,
      headers: {
        ...baseHeaders,
        ...(getCookieHeader() ? { cookie: getCookieHeader() } : {}),
      },
      timeout,
    });

    const pageStatus = Number(pageRes.statusCode || pageRes.status || 0);
    updateCookies(pageRes.headers);

    if (pageStatus === 403) {
      logError(
        `[FlowerCloud] 触发 Cloudflare 403 拦截！请在脚本参数中配置有效的 cf_clearance 与匹配的 ua`
      );
      return proxies;
    }

    const pageHtml = String(pageRes.body || '');
    const tokenMatch =
      pageHtml.match(/name=["']token["']\s+value=["']([a-f0-9]{40})["']/i) ||
      pageHtml.match(/csrfToken\s*=\s*["']([a-f0-9]{40})["']/i);

    if (!tokenMatch || !tokenMatch[1]) {
      logError(
        `[FlowerCloud] 未能从 clientarea.php 提取到 40 位 CSRF Token（状态码: ${pageStatus}），跳过`
      );
      return proxies;
    }

    const csrfToken = tokenMatch[1];
    logInfo(`[FlowerCloud] 成功提取 CSRF Token: ${csrfToken}`);

    // ==================== Step 2: 提交登录表单 (POST /dologin.php) ====================
    const alreadyLoggedIn =
      pageHtml.includes('logout.php') && !pageHtml.includes('dologin.php');

    if (alreadyLoggedIn) {
      logInfo(`[FlowerCloud] [2/4] 检测到当前 Cookie 已处于登录状态，跳过重复登录`);
    } else {
      const loginUrl = `${api}/dologin.php`;
      logInfo(`[FlowerCloud] [2/4] 提交账号密码至登录接口: ${loginUrl}`);

      const formBody = [
        `token=${encodeURIComponent(csrfToken)}`,
        `username=${encodeURIComponent(user)}`,
        `password=${encodeURIComponent(password)}`,
      ].join('&');

      const loginRes = await $.http.post({
        url: loginUrl,
        headers: {
          ...baseHeaders,
          'content-type': 'application/x-www-form-urlencoded',
          origin: api,
          referer: clientareaUrl,
          cookie: getCookieHeader(),
        },
        body: formBody,
        followRedirect: false,
        'auto-redirect': false,
        redirection: false,
        timeout,
      });

      const loginStatus = Number(loginRes.statusCode || loginRes.status || 0);
      updateCookies(loginRes.headers);

      const locationHeader =
        loginRes.headers?.location || loginRes.headers?.Location || '';
      logInfo(
        `[FlowerCloud] 登录响应状态码: ${loginStatus}, 跳转 Location: ${locationHeader}`
      );

      if (String(locationHeader).includes('incorrect=true')) {
        logError(`[FlowerCloud] 登录失败：邮箱或密码错误 (incorrect=true)`);
        return proxies;
      }
    }

    // ==================== Step 3: 开启订阅开关 (ActivateSublink) ====================
    const productDetailsUrl = `${api}/clientarea.php?action=productdetails&id=${encodeURIComponent(
      serviceId
    )}`;
    const activateUrl = `${productDetailsUrl}&V2raySocksAction=ActivateSublink&Serviceid=${encodeURIComponent(
      serviceId
    )}`;
    logInfo(`[FlowerCloud] [3/4] 正在开启订阅开关: ${activateUrl}`);

    const activateRes = await $.http.get({
      url: activateUrl,
      headers: {
        ...baseHeaders,
        referer: productDetailsUrl,
        cookie: getCookieHeader(),
      },
      timeout,
    });

    const activateStatus = Number(
      activateRes.statusCode || activateRes.status || 0
    );
    const activateText = String(activateRes.body || '').trim();
    logInfo(
      `[FlowerCloud] 开启订阅开关响应 (状态码 ${activateStatus}): ${activateText.slice(
        0,
        100
      )}`
    );

    if (activateText === 'success') {
      logInfo(`✅ [FlowerCloud] 订阅更新开关开启成功！`);
    } else {
      logError(
        `⚠️ [FlowerCloud] 开启订阅开关返回非预期内容: ${activateText.slice(0, 120)}`
      );
    }

    // ==================== Step 4: 获取订阅流量信息与节点 ====================
    let targetSubUrl = subUrl;
    const source = context?.source;
    if (!targetSubUrl && source) {
      for (const name in source) {
        if (source[name]?.url && /^https?:\/\//i.test(source[name].url)) {
          targetSubUrl = source[name].url;
          break;
        }
      }
    }

    let subscriptionUserinfo = '';
    let rawSubBody = '';
    let finalProxies = proxies;

    // 4A. 如果有现成订阅链接（subUrl 参数或单条订阅里的远程 URL），请求它获取节点和响应头流量
    if (targetSubUrl) {
      logInfo(`[FlowerCloud] [4/4] 正在请求现成订阅链接: ${targetSubUrl}`);
      const subRes = await $.http.get({
        url: targetSubUrl,
        headers: {
          'user-agent': subUA,
        },
        timeout,
      });

      const subStatus = Number(subRes.statusCode || subRes.status || 0);
      if (subStatus >= 200 && subStatus < 400) {
        rawSubBody = String(subRes.body || '');
        subscriptionUserinfo =
          subRes.headers?.['subscription-userinfo'] ||
          subRes.headers?.['Subscription-Userinfo'] ||
          '';
        if (subscriptionUserinfo) {
          logInfo(
            `📊 [FlowerCloud] 从订阅响应头获取到流量信息: ${subscriptionUserinfo}`
          );
        }

        try {
          const parsed = ProxyUtils.parse(rawSubBody);
          if (Array.isArray(parsed) && parsed.length > 0) {
            finalProxies = parsed;
            logInfo(`🎉 [FlowerCloud] 成功解析节点数: ${parsed.length}`);
          }
        } catch (e) {
          logError(`[FlowerCloud] 解析订阅节点失败: ${e.message ?? e}`);
        }
      } else {
        logError(`[FlowerCloud] 请求现成订阅地址失败，状态码: ${subStatus}`);
      }
    }

    // 4B. 如果订阅响应头没有返回流量信息（例如使用了 subconverter 转换链接或未传 subUrl），
    // 直接从已登录的 WHMCS 产品详情页 HTML 中提取精确流量与到期时间！
    if (!subscriptionUserinfo) {
      logInfo(
        `[FlowerCloud] 正在从产品详情页 (${productDetailsUrl}) 提取面板流量与到期信息...`
      );
      const detailRes = await $.http.get({
        url: productDetailsUrl,
        headers: {
          ...baseHeaders,
          cookie: getCookieHeader(),
        },
        timeout,
      });
      const detailHtml = String(detailRes.body || '');
      subscriptionUserinfo = parseUserinfoFromHtml(detailHtml);
      if (subscriptionUserinfo) {
        logInfo(
          `📊 [FlowerCloud] 从面板详情页成功提取流量信息: ${subscriptionUserinfo}`
        );
      } else {
        logError(`[FlowerCloud] 未能从面板详情页提取到流量信息`);
      }
    }

    // 将流量信息与节点写回 Sub-Store
    if (subscriptionUserinfo || rawSubBody) {
      saveToSubStore(subscriptionUserinfo, rawSubBody, targetSubUrl);
    }

    return finalProxies;
  } catch (err) {
    logError(`[FlowerCloud] 脚本执行异常: ${err.message ?? err}`);
    return proxies;
  }
}
