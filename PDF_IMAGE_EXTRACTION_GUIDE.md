# PDF Question Image Extraction Guide

## Feature Overview
The system now automatically extracts images from PDF files when you upload PDF questions. Images are linked to their corresponding questions and displayed alongside the question text.

## Recommended PDF Format

### Image Specifications
- **Format:** JPG or PNG
- **Recommended Dimensions:** 600x400px or 800x600px
- **Maximum Dimensions:** 1000x800px (will work, but larger files)
- **File Size Per Image:** Max 500KB (recommended: 100-300KB)
- **Color Profile:** RGB (not CMYK)
- **DPI:** 96-150 DPI (for web display)

### PDF Structure

Create your PDF questions in this format:

```
Q1) What is the capital of India?
[IMAGE - embed the image here in the PDF]
A) Delhi
B) Mumbai
C) Bangalore
D) Chennai
Answer: A

Q2) What is 2+2?
A) 2
B) 3
C) 4
D) 5
Answer: C

Q3) [Question with image]
[IMAGE - embed the image here]
A) Option A
B) Option B
C) Option C
D) Option D
Answer: A
```

### How to Create PDFs with Images

#### Using Microsoft Word:
1. Create a document with question numbers (Q1, Q2, etc.)
2. Insert images after each question
3. Add answer options (A, B, C, D) after the image
4. Mark the correct answer
5. Save as PDF

#### Using LibreOffice:
1. Create a presentation or document with questions
2. Insert images
3. Add options below images
4. Export as PDF

#### Using Google Docs:
1. Create a document with questions and images
2. Insert images using Insert → Image
3. Add answer options
4. File → Download → PDF Document

### Naming Conventions

Use clear question markers:
- `Q1)` or `Q1.` or `Question 1:`
- `Q2)` or `Q2.` or `Question 2:`

Answer markers:
- `A)`, `B)`, `C)`, `D)` (with closing bracket or period)
- `A.`, `B.`, `C.`, `D.` (with period)
- `A :`, `B :`, `C :`, `D :` (with colon)

Correct answer markers:
- `Answer: A`
- `Ans: A`
- `Correct: A`
- `Answer: A)`
- `Correct Answer: A`

### Example PDF Question

```
Q1) Which image shows the correct answer?

[HIGH-QUALITY IMAGE HERE - 600x400px JPG, ~200KB]

A) Delhi
B) Mumbai
C) Bangalore
D) Chennai
Answer: A
```

## How the Feature Works

1. **Upload PDF**: Click "Upload Questions PDF" and select your PDF file
2. **Automatic Extraction**: The system extracts:
   - Question text
   - Answer options (A, B, C, D)
   - Correct answer
   - Images embedded in the PDF
3. **Image Preview**: When you click "NEXT PDF QUESTION", the image preview shows below the question
4. **Format Auto-Detection**: If an image is found, format automatically switches to "Image + Text"
5. **Send Question**: Click "SEND QUESTION TO ALL" to send the question with the image to players

## Image Placement in PDF

- **Best Practice:** Place images immediately after the question text and before the answer options
- **Images are extracted in order:** The first image on a page is linked to the first question, etc.
- **Multiple images:** If a question doesn't have an image, it's skipped and the next question gets the next image

## Performance Tips

- **Keep images optimized**: Compress images to 100-300KB per image
- **Use JPG for photos**: Better compression than PNG
- **Use PNG for diagrams**: Better for graphics and text
- **Test on slow connection**: Ensure images load within 10 seconds

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Images not extracting | Check PDF is not encrypted; ensure images are embedded (not links) |
| Wrong image for question | Reorder images in PDF to match question order |
| Images too large/slow | Compress images using online tools (tinypng.com, imagecompressor.com) |
| Blurry images | Use higher quality source or increase DPI to 150 |
| Images not displaying on player | Check file size; very large images may not transmit properly |

## Supported Image Types in PDF

- JPEG (.jpg, .jpeg)
- PNG (.png)
- Grayscale, RGB, and some other color formats

## File Size Limitations

- **Single PDF:** Max 50MB (server limit)
- **Per Image:** Max 500KB recommended
- **Total Questions:** Tested with 100+ questions

---

**Tip:** Always test your PDF with 1-2 questions before adding all questions!
