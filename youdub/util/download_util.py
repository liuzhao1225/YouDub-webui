import aiofiles
import httpx


async def fetch_data(url: str, headers=None, file_path=None):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    } if headers is None else headers
    
    async with httpx.AsyncClient(follow_redirects=True) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status()

        # 检查文件大小
        content_length = response.headers.get('content-length')
        if content_length and int(content_length) == 0:
            raise ValueError("文件大小为0")

        if not response.content:
            raise ValueError("未获取到文件内容")

        if file_path:
            async with aiofiles.open(file_path, 'wb') as out_file:
                await out_file.write(response.content)
        return response
