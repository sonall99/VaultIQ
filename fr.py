import google.generativeai as genai
genai.configure(api_key='AIzaSyBIJt4jV0tGH-oDAc1OLEJAw2IIFteUMmU')
for m in genai.list_models():
    if 'generateContent' in m.supported_generation_methods:
        print(m.name)