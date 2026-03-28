// Cloudflare Worker - GitHub 仓库文件编辑器 API (安全增强版)
// 支持 github_pat_ 和 ghp_ 两种令牌格式
// 敏感信息通过环境变量注入

// ========== 辅助函数 ==========
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * 从环境变量中获取并验证 API Key 映射
 */
function validateApiKey(request, env) {
  const apiKey = request.headers.get("X-API-Key");
  if (!apiKey) return false;

  try {
    const validKeys = JSON.parse(env.VALID_API_KEYS || '{}');
    return !!validKeys[apiKey];
  } catch {
    return false;
  }
}

function errorResponse(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status: status,
    headers: { "Content-Type": "application/json", ...corsHeaders() }
  });
}

function successResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders() }
  });
}

/**
 * 安全地解码 base64 为 UTF-8 字符串
 */
function decodeBase64Utf8(base64Str) {
  const binaryString = atob(base64Str);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * 安全地编码 UTF-8 字符串为 base64
 */
function encodeBase64Utf8(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binaryString = '';
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}

/**
 * 校验文件路径，防止路径遍历攻击
 */
function isValidPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  if (filePath.includes('..') || filePath.startsWith('/')) return false;
  if (filePath.length > 1024) return false;
  return true;
}

/**
 * 验证 GitHub Token 格式（可选，用于提前提示）
 */
function validateGitHubToken(token) {
  if (!token) return false;
  // 支持旧版 ghp_ 和新版 github_pat_ 令牌
  return token.startsWith('ghp_') || token.startsWith('github_pat_');
}

/**
 * 读取 GitHub 文件内容
 */
async function readGitHubFile(filePath, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`;
  
  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,  // 使用 Bearer 更规范
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "Cloudflare-Worker-GitHub-Editor",
      "X-GitHub-Api-Version": "2022-11-28"  // 指定 API 版本，提高稳定性
    }
  });
  
  if (!response.ok) {
    if (response.status === 404) {
      return { exists: false, content: null, sha: null };
    }
    const error = await response.text();
    throw new Error(`GitHub API 错误 (${response.status})`);
  }
  
  const data = await response.json();
  let content;
  try {
    content = decodeBase64Utf8(data.content);
  } catch (e) {
    content = atob(data.content);
  }
  
  return { exists: true, content: content, sha: data.sha };
}

/**
 * 写入/更新 GitHub 文件
 */
async function writeGitHubFile(filePath, content, sha, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`;
  
  let encodedContent;
  try {
    encodedContent = encodeBase64Utf8(content);
  } catch (e) {
    encodedContent = btoa(content);
  }
  
  const body = {
    message: sha ? `Update ${filePath}` : `Create ${filePath}`,
    content: encodedContent,
    branch: env.GITHUB_BRANCH || "main"  // 支持自定义分支
  };
  if (sha) body.sha = sha;
  
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "Cloudflare-Worker-GitHub-Editor",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API 写入错误 (${response.status})`);
  }
  
  const data = await response.json();
  return { success: true, commit: data.commit };
}

// ========== 主处理函数 ==========
export default {
  async fetch(request, env, ctx) {
    // 处理 OPTIONS 预检请求
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    // 验证 API Key
    if (!env.VALID_API_KEYS) {
      return errorResponse("服务未正确配置: 缺少 VALID_API_KEYS 环境变量", 500);
    }
    if (!validateApiKey(request, env)) {
      return errorResponse("无效或缺失的 API Key，请在请求头中提供 X-API-Key", 401);
    }

    // 验证必需的 GitHub 配置
    if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) {
      return errorResponse("服务未正确配置: 缺少 GitHub 相关环境变量", 500);
    }
    
    // 验证 Token 格式（可选，帮助排查问题）
    if (!validateGitHubToken(env.GITHUB_TOKEN)) {
      console.warn("警告: GitHub Token 格式可能不正确，应为 ghp_ 或 github_pat_ 开头");
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ========== GET /read?file=path ==========
    if (path === "/read" && request.method === "GET") {
      const filePath = url.searchParams.get("file");
      if (!filePath) {
        return errorResponse("缺少 file 参数");
      }
      if (!isValidPath(filePath)) {
        return errorResponse("文件路径包含非法字符（如 '..' 或 '/'）", 400);
      }

      try {
        const result = await readGitHubFile(filePath, env);
        if (!result.exists) {
          return errorResponse(`文件不存在: ${filePath}`, 404);
        }
        return successResponse({
          file: filePath,
          content: result.content,
          sha: result.sha
        });
      } catch (err) {
        return errorResponse(`读取失败: ${err.message}`, 500);
      }
    }

    // ========== POST /write ==========
    else if (path === "/write" && request.method === "POST") {
      // 限制请求体大小
      const contentLength = request.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
        return errorResponse("请求体过大，最大允许 5MB", 413);
      }

      let body;
      try {
        body = await request.json();
      } catch (e) {
        return errorResponse("请求体必须是有效的 JSON");
      }

      const { file, content, sha } = body;
      if (!file) {
        return errorResponse("缺少 file 字段");
      }
      if (content === undefined) {
        return errorResponse("缺少 content 字段");
      }
      if (!isValidPath(file)) {
        return errorResponse("文件路径包含非法字符（如 '..' 或 '/'）", 400);
      }
      if (typeof content === 'string' && content.length > 10 * 1024 * 1024) {
        return errorResponse("文件内容过大，最大允许 10MB", 413);
      }

      try {
        let finalSha = sha;
        if (!finalSha) {
          const existing = await readGitHubFile(file, env);
          if (existing.exists) {
            finalSha = existing.sha;
          }
        }
        const result = await writeGitHubFile(file, content, finalSha, env);
        return successResponse({
          success: true,
          file: file,
          message: "文件保存成功",
          commit: result.commit
        });
      } catch (err) {
        return errorResponse(`写入失败: ${err.message}`, 500);
      }
    }

    else {
      return errorResponse("Not Found. 支持端点: GET /read?file=path 和 POST /write", 404);
    }
  }
};