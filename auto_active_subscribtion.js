/**
 * FlowerCloud (WHMCS) 自动登录并打开订阅开关 - Sub-Store 脚本操作 (Script Operator)
 *
 * 参考模板：https://raw.githubusercontent.com/xream/scripts/main/surge/modules/sub-store-scripts/sub-info/autoLogin.js
 *
 * ==================== 为什么之前日志里没有任何输出？（必看排错指南） ====================
 * 1. 【单条订阅“本地”内容不能完全留空】：
 *    在 Sub-Store 中，如果单条订阅设为「本地 (Local)」且内容为空，或者「远程」拉取失败返回 0 个节点，
 *    Sub-Store 引擎会认为没有节点需要处理，从而【直接跳过后面所有的脚本操作 (`operator`)】！
 *    👉 解决办法：
 *       - 如果你选「本地 (Local)」，请在订阅内容框里随便填一行占位节点，例如：
 *         `placeholder = direct` 或 `ss://YWVzLTI1Ni1nY206dGVzdA==@127.0.0.1:8888#Placeholder`
 *       - 如果你选「远程 (Remote)」并填入了你现成的订阅链接，请把本脚本加在「脚本操作」第一位；
 *         若开关关闭时远程订阅拉取报错导致不进脚本，请改用「本地 + 一行占位节点 `placeholder = direct`」，并把你的现成订阅链接填到下面的 `subUrl` 参数中。
 *
 * 2. 【Docker / Node.js 版 Sub-Store (v2.38.0+) 安全限制】：
 *    自 Sub-Store v2.38.0 起，如果部署 Docker/Node 时未设置环境变量 `SUB_STORE_FRONTEND_BACKEND_PATH`，
 *    后端会默认【静默禁用所有 Script Operator 脚本操作】！
 *    👉 解决办法：确认启动容器时配置了 `-e SUB_STORE_FRONTEND_BACKEND_PATH=/你的安全路径`（或 `/ `）。
 *
 * 3. 【脚本类型选错】：
 *    请确认添加的是「脚本操作 (Script Operator)」，而不是「脚本过滤器 (Script Filter)」。
 */

async function operator(proxies = [], targetPlatform, context) {
  const $ = $substore;
  const SUBS_KEY = 'subs';
  const args = typeof $arguments !== 'undefined' && $arguments ? $arguments : {};

  // 双通道日志（同时输出到 Sub-Store 日志面板 $.info 与 Node/客户端控制台 console.log）
  const logInfo = (msg) => {
    console.log(msg);
    if ($ && typeof $.info === 'function') $.info(msg);
  };
  const logError = (msg) => {
    console.error(msg);
    if ($ && typeof $.error === 'function') $.error(msg);
  };

  logInfo(`🚀 [FlowerCloud] 开始执行自动登录并开启订阅开关脚本... (当前传入节点数: ${proxies.length})`);

  // 1. 读取参数（支持 Sub-Store $arguments 传参，未传时使用抓包提取的默认值）
  const api = String(args.api || 'https://api-flowercloud.com').replace(/\/+$/, '');
  const user = args.user || args.username || 'zyx1069958401@gmail.com';
  const password = args.password || 'as159753';
  const serviceId = String(args.serviceId || args.id || '318178');
  const ua =
    args.ua ||
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1';
  const cfClearance = args.cf_clearance || args.cfClearance || '';
  // 如果你有现成的订阅链接，既可以通过参数 subUrl 传入，也可以直接填在下方引号里：
  const subUrl = args.subUrl || args.sub_url || '';
  const subUA = args.subUA || args.sub_ua || 'clash.meta';
  const timeout = Number(args.timeout) || 15000;

  // 2. 简易 Cookie 管理器（跨 Step 1 -> Step 2 -> Step 3 维护 WHMCS 会话 Cookie）
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

  const baseHeaders = {
    'user-agent': ua,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'zh-CN,zh-Hans;q=0.9',
  };

  try {
    // ==================== Step 1: 访问登录页获取 CSRF Token 与初始 Cookie ====================
    const clientareaUrl = `${api}/clientarea.php`;
    logInfo(`[FlowerCloud] [1/3] 请求登录页获取 CSRF Token: ${clientareaUrl}`);

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
      logInfo(`[FlowerCloud] [2/3] 检测到当前 Cookie 已处于登录状态，跳过重复登录`);
    } else {
      const loginUrl = `${api}/dologin.php`;
      logInfo(`[FlowerCloud] [2/3] 提交账号密码至登录接口: ${loginUrl}`);

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
    const activateUrl = `${api}/clientarea.php?action=productdetails&id=${encodeURIComponent(
      serviceId
    )}&V2raySocksAction=ActivateSublink&Serviceid=${encodeURIComponent(
      serviceId
    )}`;
    logInfo(`[FlowerCloud] [3/3] 正在开启订阅开关: ${activateUrl}`);

    const activateRes = await $.http.get({
      url: activateUrl,
      headers: {
        ...baseHeaders,
        referer: `${api}/clientarea.php?action=productdetails&id=${encodeURIComponent(
          serviceId
        )}`,
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

    // ==================== Step 4: 拉取现成订阅链接（若配置了 subUrl 或远程订阅因开关关闭为空） ====================
    // 如果没有显式传 subUrl，但当前订阅是远程订阅 (context.source 存在 url)，且刚才开启开关前拉取到的节点很少/仅有占位节点，
    // 自动从当前订阅配置中读取你填好的现成订阅 URL 重新拉取一次！
    let targetSubUrl = subUrl;
    const source = context?.source;
    if (!targetSubUrl && source) {
      for (const name in source) {
        if (source[name]?.url && /^https?:\/\//i.test(source[name].url)) {
          targetSubUrl = source[name].url;
          logInfo(`[FlowerCloud] 自动读取当前订阅配置的现成链接: ${targetSubUrl}`);
          break;
        }
      }
    }

    if (!targetSubUrl) {
      return proxies;
    }

    logInfo(`[FlowerCloud] 正在拉取现成订阅链接节点: ${targetSubUrl}`);
    const { statusCode, body, headers } = await $.http.get({
      url: targetSubUrl,
      headers: {
        'user-agent': subUA,
      },
      timeout,
    });

    const subStatus = Number(statusCode || 0);
    if (subStatus < 200 || subStatus >= 400) {
      logError(`[FlowerCloud] 请求订阅地址失败，状态码 ${subStatus}，保留原节点列表`);
      return proxies;
    }

    let parsed;
    try {
      parsed = ProxyUtils.parse(body);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        logError(`[FlowerCloud] 订阅不包含有效节点，保留原节点列表`);
        return proxies;
      }
      logInfo(`🎉 [FlowerCloud] 成功从现成链接解析节点数: ${parsed.length}`);
    } catch (e) {
      logError(`[FlowerCloud] 解析订阅节点失败: ${e.message ?? e}，保留原节点列表`);
      return proxies;
    }

    const subscriptionUserinfo =
      headers?.['subscription-userinfo'] || headers?.['Subscription-Userinfo'];
    if (subscriptionUserinfo) {
      logInfo(`[FlowerCloud] 订阅流量信息: ${subscriptionUserinfo}`);
    }

    if (source && $.read && $.write) {
      const allSubs = $.read(SUBS_KEY) || [];
      for (const name in source) {
        const sub = source[name];
        if (sub?.name) {
          for (let index = 0; index < allSubs.length; index++) {
            if (sub.name === allSubs[index].name) {
              logInfo(`[FlowerCloud] 写入最新流量信息与节点内容到 Sub-Store`);
              if (subscriptionUserinfo) {
                allSubs[index].subUserinfo = subscriptionUserinfo;
              }
              allSubs[index].content = body;
              break;
            }
          }
          break;
        }
      }
      $.write(allSubs, SUBS_KEY);
    }

    return parsed;
  } catch (err) {
    logError(`[FlowerCloud] 脚本执行异常: ${err.message ?? err}`);
    return proxies;
  }
}
