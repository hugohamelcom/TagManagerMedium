/**
 * Main worker entry point.
 *
 */
addEventListener("fetch", event => {
  // Fail-safe in case of an unhandled exception
  event.passThroughOnException();
  event.respondWith(processRequest(event.request, event));
});

// Workers can only decode utf-8 so keep a list of character encodings that can be decoded.
const VALID_CHARSETS = ['utf-8', 'utf8', 'iso-8859-1', 'us-ascii'];

// Our Tag Manager Snippet
const TAG_MANAGER = `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-XXXXXXX');</script>`;

/**
 * Handle all requests. Send HTML on for further processing
 * and pass everything else through unmodified.
 * @param {*} request - Original request
 * @param {*} event - Original worker event
 */
async function processRequest(request, event) {
  const response = await fetch(request);
  if (response && response.status === 200) {
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("text/html") !== -1) {
      return await processHtmlResponse(response, event.request, event);
    }
  }

  return response;
}

/**
 * Handle all of the processing for a (likely) HTML request.
 * - Pass through the request to the origin and inspect the response.
 * - If the response is HTML set up a streaming transform and pass it on to modifyHtmlStream for processing
 * 
 * Extra care needs to be taken to make sure the character encoding from the original
 * HTML is extracted and converted to utf-8 and that the downstream response is identified
 * as utf-8.
 * 
 * @param {*} response The original response
 * @param {*} request The original request
 * @param {*} event worker event object
 */
async function processHtmlResponse(response, request, event) {
  // Workers can only decode utf-8. If it is anything else, pass the
  // response through unmodified
  const contentType = response.headers.get("content-type");
  const charsetRegex = /charset\s*=\s*([^\s;]+)/mgi;
  const match = charsetRegex.exec(contentType);
  if (match !== null) {
    let charset = match[1].toLowerCase();
    if (!VALID_CHARSETS.includes(charset)) {
      return response;
    }
  }
  
  // Create an identity TransformStream (a.k.a. a pipe).
  // The readable side will become our new response body.
  const { readable, writable } = new TransformStream();

  // Create a cloned response with our modified stream
  const newResponse = new Response(readable, response);

  // Start the async processing of the response stream
  modifyHtmlStream(response.body, writable, request, event);

  // Return the in-process response so it can be streamed.
  return newResponse;
}


/**
 * Check to see if the HTML chunk includes a meta tag for an unsupported charset
 * @param {*} chunk - Chunk of HTML to scan
 * @returns {bool} - true if the HTML chunk includes a meta tag for an unsupported charset
 */
function chunkContainsInvalidCharset(chunk) {
  let invalid = false;

  // meta charset
  const charsetRegex = /<\s*meta[^>]+charset\s*=\s*['"]([^'"]*)['"][^>]*>/mgi;
  const charsetMatch = charsetRegex.exec(chunk);
  if (charsetMatch) {
    const docCharset = charsetMatch[1].toLowerCase();
    if (!VALID_CHARSETS.includes(docCharset)) {
      invalid = true;
    }
  }
  // content-type
  const contentTypeRegex = /<\s*meta[^>]+http-equiv\s*=\s*['"]\s*content-type[^>]*>/mgi;
  const contentTypeMatch = contentTypeRegex.exec(chunk);
  if (contentTypeMatch) {
    const metaTag = contentTypeMatch[0];
    const metaRegex = /charset\s*=\s*([^\s"]*)/mgi;
    const metaMatch = metaRegex.exec(metaTag);
    if (metaMatch) {
      const charset = metaMatch[1].toLowerCase();
      if (!VALID_CHARSETS.includes(charset)) {
        invalid = true;
      }
    }
  }
  return invalid;
}

/**
 * Process the streaming HTML response from the origin server.
 * - Attempt to buffer the full head
 * - Scan the first response chunk for a charset meta tag (and bail if it isn't a supported charset)
 * - Pass the gathered head and each subsequent chunk to modifyHtmlChunk() for actual processing of the text.
 * 
 * @param {*} readable - Input stream (from the origin).
 * @param {*} writable - Output stream (to the browser).
 * @param {*} request - Original request object for downstream use.
 * @param {*} event - Worker event object
 */
async function modifyHtmlStream(readable, writable, request, event) {
  const reader = readable.getReader();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let decoder = new TextDecoder("utf-8", {fatal: true});

  let firstChunk = true;
  let unsupportedCharset = false;

  let partial = '';
  let content = '';

  try {
    for(;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      let chunk = null;
      if (unsupportedCharset) {
        // Pass the data straight through
        await writer.write(value);
        continue;
      } else {
        try {
          chunk = decoder.decode(value, {stream:true});
        } catch (e) {
          // Decoding failed, switch to passthrough
          unsupportedCharset = true;
          await writer.write(value);
          continue;
        }
      }

      try {
        // Look inside of the first chunk for a HTML charset or content-type meta tag.
        if (firstChunk) {
          firstChunk = false;
          if (chunkContainsInvalidCharset(chunk)) {
            // switch to passthrough
            unsupportedCharset = true;
            await writer.write(value);
            continue;
          }
        }

        content = chunk;

        const headPos = content.indexOf('</head>');
        if (headPos > -1) {
          content = [content.slice(0,headPos),TAG_MANAGER,content.slice(headPos)].join('');
        }

      } catch (e) {
        // Ignore the exception
      }
      if (content.length) {
        await writer.write(encoder.encode(content));
        content = '';
      }
    }
  } catch(e) {
    // Ignore the exception
  }

  try {
    await writer.close();
  } catch(e) {
    // Ignore the exception
  }
}

/**
 * LICENSE
 * 
 * The source code above is to a great extent a modified version of the Cloudflare Fast Google Fonts 
 * code which inflicts the license conditions below.
 * 
 * Copyright (c) 2018, Cloudflare, Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 * list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 * this list of conditions and the following disclaimer in the documentation and/or
 * other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors
 * may be used to endorse or promote products derived from this software without
 * specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
 * ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
