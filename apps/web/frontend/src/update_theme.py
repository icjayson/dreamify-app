import re
import sys

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # Replacements
    # text-white -> text-foreground dark:text-white
    # Make sure we don't replace text-white/50 with text-foreground dark:text-white/50 by using negative lookahead
    content = re.sub(r'text-white(?![/\w-])', r'text-foreground dark:text-white', content)
    
    # text-white/xx -> text-foreground/xx dark:text-white/xx
    content = re.sub(r'text-white/([0-9]+)', r'text-muted-foreground dark:text-white/\1', content)
    
    # decoration-white -> decoration-foreground dark:decoration-white
    content = re.sub(r'decoration-white(?![/\w-])', r'decoration-foreground dark:decoration-white', content)
    
    # decoration-white/xx -> decoration-foreground/xx dark:decoration-white/xx
    content = re.sub(r'decoration-white/([0-9]+)', r'decoration-foreground/\1 dark:decoration-white/\1', content)
    
    # bg-white/xx -> bg-foreground/xx dark:bg-white/xx
    content = re.sub(r'bg-white/([0-9]+)', r'bg-foreground/\1 dark:bg-white/\1', content)
    
    # border-white/xx -> border-foreground/xx dark:border-white/xx
    content = re.sub(r'border-white/([0-9]+)', r'border-border dark:border-white/\1', content)
    
    # from-white -> from-foreground dark:from-white
    content = re.sub(r'from-white(?![/\w-])', r'from-foreground dark:from-white', content)
    
    # via-white -> via-foreground dark:via-white
    content = re.sub(r'via-white(?![/\w-])', r'via-foreground dark:via-white', content)
    
    # stroke-white -> stroke-foreground dark:stroke-white
    content = re.sub(r'stroke-white(?![/\w-])', r'stroke-foreground dark:stroke-white', content)

    # Some hardcoded text-muted-foreground/xx dark:text-white/xx might have been created already,
    # we don't want to double replace but re.sub might do it if not careful.
    # Actually wait, my regexes look for 'text-white' exactly, so it shouldn't double replace.
    # Wait, 'dark:text-white' has 'text-white' in it! 
    # Let's fix that by adding a negative lookbehind for 'dark:'
    
    pass

# We need a more robust solution that avoids touching 'dark:' prefixed classes
