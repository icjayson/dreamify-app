import os
import aiohttp
from fastapi import HTTPException

async def download_image(url: str, temp_dir: str) -> str:
    filename = os.path.join(temp_dir, os.path.basename(url))
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            if resp.status != 200:
                raise HTTPException(status_code=400, detail=f"Failed to download {url}")
            with open(filename, "wb") as f:
                f.write(await resp.read())
    return filename
