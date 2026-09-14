FROM node:20-alpine

WORKDIR /app

# Copy dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Ensure data and uploads directories exist
RUN mkdir -p data uploads

EXPOSE 3001

CMD ["npm", "start"]
