import regex
def clean_json(content: str) -> str:
    """
    Cleans the JSON content by removing unnecessary characters and formatting.
    """
    # Remove leading and trailing whitespace
    # Remove code block markers
    # Replace newlines with spaces
    # Remove 'json' keyword if present
    # Return cleaned content    
    cleaned = content.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    if cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]

    cleaned = cleaned.replace("json", "").replace(
        "```", "").replace("\n", " ").strip()
    return cleaned

def contain_strange_characters(s: str) -> bool:
    # Match only Latin letters (with diacritics) and spaces
    return not bool(regex.fullmatch(r"[\p{Latin}\- ]+", s))
