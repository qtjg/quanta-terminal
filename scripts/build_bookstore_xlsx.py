#!/usr/bin/env python3
"""Build Book Stores in Bihar directory workbook."""
import sys, os
XLSX_SKILL_DIR = "/home/z/my-project/skills/xlsx"
for sub in [XLSX_SKILL_DIR, os.path.join(XLSX_SKILL_DIR, "templates")]:
    if sub not in sys.path:
        sys.path.insert(0, sub)

from base import *  # design tokens + style helpers
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment
from openpyxl.utils import get_column_letter

OUT = "/home/z/my-project/download/Bihar_Book_Stores_Directory.xlsx"
os.makedirs(os.path.dirname(OUT), exist_ok=True)

wb = Workbook()

# ============ Sheet 1: Book Store Directory ============
ws = wb.active
ws.title = "Book Store Directory"

headers = ["#", "Store Name", "City", "Full Address", "Phone / Contact",
           "Website / Online Link", "Email", "Timings", "Specialty & Notes",
           "Rating / Since"]
last_col = len(headers) + 1  # B start

setup_sheet(ws, title="Book Stores in Bihar — Directory (Patna, Gaya, Bhagalpur, Muzaffarpur)", last_col=last_col)

for col_idx, h in enumerate(headers, start=2):
    ws.cell(row=4, column=col_idx, value=h)
style_header_row(ws, row_num=4, col_start=2, col_end=last_col)

data = [
    [1, "Crossword (City Centre Mall)", "Patna",
     "Store No. C0302, 3rd Floor, City Centre Mall, Block C, Lodipur, Patna - 800001",
     "+91 612-2330411 / +91 85302 06759",
     "www.crossword.in", "cwpatna22@gmail.com / estore@crossword.in",
     "Mon-Sun 11:00 AM - 9:30 PM",
     "National chain. Fiction, comics & manga, kids' zone, self-help, stationery, toys. EMI & Cash on Delivery accepted. Online store + store pickup.",
     "4.9/5 (ThreeBestRated)"],
    [2, "Scientific Book Company", "Patna",
     "Gate No. 2, Ashok Rajpath, Opposite PMCH Hospital, Near Makhania Kuan Road, Lalbagh, Patna - 800004",
     "+91 91622 59222 / 0612-2301724",
     "facebook.com/scientificbookcompany", "scientificbookco@gmail.com",
     "Mon-Sat 10:00 AM - 8:00 PM (Sun closed)",
     "Since 1948. Leading medical/dental/homeopathy/ayurveda/paramedical book publisher & distributor of Eastern India. Attractive discounts + home delivery.",
     "4.8/5 (Since 1948)"],
    [3, "Hind Book Depot", "Patna",
     "Gandhi Market, Shops No. 23 & 24, Opposite Loan Ki Masjid, Ashok Rajpath, Patna - 800004",
     "+91 70616 40563 / +91 80476 84096",
     "www.hindbook.in", "hindenterprises040@gmail.com",
     "Mon-Sun 9:00 AM - 8:00 PM",
     "Since 1955. UPSC/SSC/Railway/Banking exam books, university texts (Science/Arts/Commerce), IGNOU material. Best rates on competitive-exam titles.",
     "4.8/5 (Since 1955)"],
    [4, "Booksook (Online Book Store)", "Patna",
     "Online delivery store based in Patna, Bihar",
     "+91 70041 32447 (WhatsApp)",
     "www.booksook.com", "support@booksook.com",
     "Delivery within 24 hours in Patna",
     "Patna's own online bookstore. School books (CBSE), competitive exam guides, reference books, novels. Up to 50% off, best-price guarantee, free delivery.",
     "Online specialist"],
    [5, "The Books-En-Amee", "Patna",
     "Sahdeo Mahto Marg, Boring Road, Sri Krishna Puri, Patna - 800001",
     "0612-2540310",
     "facebook.com/booksenamee", "-",
     "Typically 10:30 AM - 8:30 PM (call to confirm)",
     "Iconic independent bookstore since 1979. Fiction, children's books, curated reads. NOTE: reportedly relocated from Boring Road in 2024 — call before visiting.",
     "Legendary indie (Since 1979)"],
    [6, "Vaishali Book Depot", "Patna",
     "Boring Road, Patna, Bihar",
     "See Justdial listing (justdial.com/Patna/Vaishali-Book-Depot-Boring-Road)",
     "justdial.com (listing page)", "-",
     "Call to confirm",
     "Well-rated academic & school book depot; textbooks and guides for local schools/colleges.",
     "5.0/5 (Justdial, 20 reviews)"],
    [7, "Zafar Book House", "Gaya",
     "GB Road, Near Chatta Masjid, Gaya - 823001, Bihar",
     "+91 88093 05171 / +91 88041 55016",
     "facebook.com/zafarbookhouse", "info@zafarbookhouse.com",
     "Open daily (call to confirm)",
     "One of Gaya's best-known book houses. School & academic books, general titles.",
     "Popular local store"],
    [8, "Granthalaya", "Bhagalpur",
     "Tilkamanjhi, Bhagalpur H.O., Bhagalpur - 812001, Bihar",
     "+91 76777 85636 / 0641-2408456 / 0641-2409383 / +91 94308 62078 (depot)",
     "justdial.com (listing page)", "-",
     "Mon-Sat 10:00 AM - 8:30 PM; Sun 10:00 AM - 12:00 PM",
     "Bhagalpur's leading bookstore. CBSE/ICSE school books, stationery, academic titles.",
     "Well-established"],
    [9, "Novelty Book Center", "Muzaffarpur",
     "Motijheel Road area, Muzaffarpur, Bihar - 842001",
     "+91 93349 08037 (Arun Ji)",
     "-", "-",
     "Call to confirm",
     "School book center & distributor for Muzaffarpur region.",
     "Regional distributor"],
    [10, "NCERT Authorised Book Stores", "Gaya / Muzaffarpur",
     "Gaya - 823001 & Muzaffarpur - 842001 (authorised NCERT depots)",
     "Gaya: 06542-236191 | Muzaffarpur: +91 94702 68375 / +91 96314 16407",
     "ncert.nic.in / nbtindia.gov.in", "-",
     "Call to confirm",
     "Official NCERT textbooks at printed MRP — cheapest source for NCERT prep material in Bihar.",
     "Government authorised"],
]

r = 5
for i, row_data in enumerate(data):
    for col_idx, value in enumerate(row_data, start=2):
        ws.cell(row=r, column=col_idx, value=value)
    style_data_row(ws, row_num=r, col_start=2, col_end=last_col, row_index=i)
    ws.cell(row=r, column=2).alignment = Alignment(horizontal='center', vertical='center')
    r += 1

last_data_row = r - 1

# Notes / sources (caption style)
notes = [
    "Sources: threebestrated.in, Justdial, citycentrepatna.com, crossward/crossword.in store locator, Facebook & Instagram official pages, bhagalpuronline.in, iasexamportal.com (NCERT stores).",
    "Compiled: Sep 2026. Prices & timings change — always call the store to confirm stock, current rates and delivery before ordering.",
    "Rates shown on 'Sample Book Rates' sheet are the latest published store prices found online (they vary by title & edition).",
]
nr = last_data_row + 2
for note in notes:
    ws.cell(row=nr, column=2, value=note).font = font_caption()
    ws.merge_cells(start_row=nr, start_column=2, end_row=nr, end_column=last_col)
    ws.cell(row=nr, column=2).alignment = Alignment(horizontal='left', vertical='center')
    nr += 1

auto_fit_columns(ws, min_width=8, max_width=42, header_row=4, data_start_row=5)
ws.freeze_panes = 'D5'
ws.column_dimensions['E'].width = 42  # address
ws.column_dimensions['J'].width = 46  # notes

# ============ Sheet 2: Sample Book Rates ============
ws2 = wb.create_sheet("Sample Book Rates")
headers2 = ["Store", "Book Title", "Price (₹)", "Category"]
last_col2 = len(headers2) + 1
setup_sheet(ws2, title="Latest Published Store Prices (Sep 2026)", last_col=last_col2)

for col_idx, h in enumerate(headers2, start=2):
    ws2.cell(row=4, column=col_idx, value=h)
style_header_row(ws2, row_num=4, col_start=2, col_end=last_col2)

rates = [
    ["Crossword, City Centre Patna", "Mahashweta (Sudha Murty)", 233, "Fiction"],
    ["Crossword, City Centre Patna", "The Complete Adventures of Feluda Vol. 1", 509, "Fiction / Kids"],
    ["Crossword, City Centre Patna", "Dollar Bahu (Sudha Murty)", 233, "Fiction"],
    ["Crossword, City Centre Patna", "PS I Love You", 424, "Fiction"],
    ["Crossword, City Centre Patna", "The Seven Husbands of Evelyn Hugo", 509, "Fiction"],
    ["Crossword, City Centre Patna", "A Gentleman in Moscow", 509, "Fiction"],
    ["Crossword, City Centre Patna", "The Guide (R.K. Narayan)", 679, "Fiction / Classic"],
    ["Crossword, City Centre Patna", "Jungle Nama", 594, "Art / Illustrated"],
    ["Crossword, City Centre Patna", "The Legend of Lakshmi Prasad", 339, "Fiction"],
    ["Crossword, City Centre Patna", "Veronika Decides to Die (Paulo Coelho)", 339, "Fiction"],
    ["Hind Book Depot, Patna", "Spectrum Modern India (Rajiv Ahir)", 190, "UPSC / Competitive"],
    ["Hind Book Depot, Patna", "Indian Polity (M. Laxmikanth, 8th Ed.)", 400, "UPSC / Competitive"],
    ["Hind Book Depot, Patna", "India's Ancient Past (R.S. Sharma)", 150, "UPSC / Competitive"],
    ["Hind Book Depot, Patna", "Environment & Ecology (Majid Husain)", 385, "UPSC / Competitive"],
    ["Hind Book Depot, Patna", "Models in Geography (Majid Husain)", 324, "UPSC / Competitive"],
    ["Hind Book Depot, Patna", "NCERT Saar Sangrah 2024", 340, "Competitive (Hindi)"],
    ["Hind Book Depot, Patna", "Ancient + Medieval + Modern India Combo", 400, "UPSC Combo"],
    ["Booksook (Online, Patna)", "School & competitive books — up to 50% off MRP", 0, "Online discount"],
    ["Scientific Book Co., Patna", "Medical/dental/paramedical titles — big in-store discounts", 0, "Academic discount"],
]
r2 = 5
for i, row_data in enumerate(rates):
    for col_idx, value in enumerate(row_data, start=2):
        ws2.cell(row=r2, column=col_idx, value=value)
    style_data_row(ws2, row_num=r2, col_start=2, col_end=last_col2, row_index=i)
    price_cell = ws2.cell(row=r2, column=4)
    price_cell.number_format = FORMATS['integer']
    price_cell.alignment = Alignment(horizontal='right', vertical='center')
    ws2.cell(row=r2, column=5).alignment = Alignment(horizontal='center', vertical='center')
    r2 += 1

# avg price row (computed value per skill rule for programmatic verification)
numeric_prices = [row[2] for row in rates if row[2] > 0]
avg_row = r2
ws2.cell(row=avg_row, column=2, value="Average price (of listed titles)")
ws2.cell(row=avg_row, column=4, value=round(sum(numeric_prices) / len(numeric_prices), 0))
style_total_row(ws2, row_num=avg_row, col_start=2, col_end=last_col2)
ws2.cell(row=avg_row, column=4).number_format = FORMATS['integer']
ws2.cell(row=avg_row, column=4).alignment = Alignment(horizontal='right', vertical='center')

nr2 = avg_row + 2
ws2.cell(row=nr2, column=2, value="Note: store-published prices from threebestrated.in snapshots; actual rates may differ by edition/discount. Crossword online (crossword.in) frequently runs up to 25-40% off; Booksook claims up to 50% off with free 24-hr delivery in Patna.").font = font_caption()
ws2.merge_cells(start_row=nr2, start_column=2, end_row=nr2, end_column=last_col2)
ws2.cell(row=nr2, column=2).alignment = Alignment(horizontal='left', vertical='center')

auto_fit_columns(ws2, min_width=8, max_width=48, header_row=4, data_start_row=5)
ws2.freeze_panes = 'B5'

wb.properties.creator = "Z.ai"
wb.save(OUT)
print("Saved:", OUT)
