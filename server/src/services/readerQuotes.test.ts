import { describe, it, expect } from 'vitest'
import { citationsOf, quotedSentence } from './readerQuotes.js'

const quoted = (statement: string, supportingSentence: string) => quotedSentence({ statement, supportingSentence })

describe('quotedSentence', () => {
  it.each([
    {
      kind: 'initials',
      statement: 'Ramsey expects the bill to pass by Friday.',
      support: 'Senator J. D. Ramsey told reporters the bill would pass by Friday.',
    },
    { kind: 'a dotted abbreviation', statement: 'Two destroyers went to the strait.', support: 'The U.S. Navy sent two destroyers to the strait on Tuesday.' },
    { kind: 'a time of day', statement: 'The launch window opens on Thursday morning.', support: 'The launch window opens at 10 a.m. EDT on Thursday.' },
    {
      kind: 'a military title',
      statement: 'The brigade will stay through the winter.',
      support: 'Gen. Marta Ellison said the brigade would stay through the winter.',
    },
    { kind: 'a courtesy title', statement: 'The treasurer resigned on Monday.', support: 'Mr. Okafor resigned on Monday after six years as treasurer.' },
    { kind: 'a month with a day', statement: 'The vote was postponed.', support: 'The vote was moved to Sept. 18 after a court ruling.' },
    { kind: 'a decimal', statement: 'The city funded two shelters.', support: 'The city approved $1.5 million for two new shelters.' },
    { kind: 'a German date', statement: 'The state parliament votes on November 12.', support: 'Die Abstimmung im Landtag findet am 12. November statt.' },
    { kind: 'a quoted exclamation and who wrote it', statement: 'The mayor backs the plan.', support: '"We are all on board!" Mayor Ruiz wrote on Sunday.' },
    {
      kind: 'a quoted question and who asked it',
      statement: 'A councilor asked who would pay.',
      support: '“Who is going to pay for this?” Councilor Brandt asked.',
    },
    {
      kind: 'a company suffix',
      statement: 'Varga said the company would invest in two plants.',
      support: 'Norvik Inc. Chief Executive Lena Varga said the company would invest $500 million in two plants.',
    },
    {
      kind: 'a plural title',
      statement: 'Two senators introduced a housing bill.',
      support: 'Sens. Maria Okoye and Daniel Frost introduced the housing bill on Monday.',
    },
    { kind: 'a German company form', statement: 'Halden will build a plant in Leipzig.', support: 'Die Halden GmbH & Co. KG baut ein Werk in Leipzig.' },
    { kind: 'an ellipsis before "I"', statement: 'The envoy expects a deal.', support: '“We are close ... I think we will get there,” the envoy said.' },
    { kind: 'a quoted Chinese question and who asked it', statement: 'He asked whether they were ready.', support: '“你们准备好了吗？”他问道。' },
    { kind: 'a quoted Chinese statement and who said it', statement: 'He said they were ready.', support: '“我们准备好了。”他说。' },
    { kind: 'a Chinese quotation at its end', statement: 'He said they were ready.', support: '他说：“我们准备好了。”' },
    { kind: 'a Chinese quoted question at its end', statement: 'He asked whether they were ready.', support: '他问：“你们准备好了吗？”' },
    {
      kind: 'a month before a capitalized word',
      statement: 'Turnout fell to 48 percent.',
      support: 'Turnout in the Nov. General Election fell to 48 percent.',
    },
  ])('quotes a one-sentence support whole, past $kind', ({ statement, support }) => {
    expect(quoted(statement, support)).toBe(support)
  })

  it('quotes a one-sentence support without the space around it', () => {
    expect(quoted('The council approved the budget.', '  The council approved the budget on Tuesday. \n')).toBe('The council approved the budget on Tuesday.')
  })

  it('takes a listed title for one only where it is capitalized: the same letters end a sentence in another language', () => {
    const support = 'Budgeten godkändes i går, säger hon. Regeringen väntar nu på riksdagen.'
    expect(quoted('The government is now waiting for parliament.', support)).toBe('Regeringen väntar nu på riksdagen.')
  })

  it('never quotes a piece without a letter or a digit', () => {
    // Nothing here shares a word with the statement, so the tie would go to the later piece
    expect(quoted('The plant is in Hefei.', '工厂位于合肥。 [...] ——')).toBe('工厂位于合肥。')
  })

  it('reads "may" after a number as the verb, so the number stays a figure', () => {
    const support = 'Fire officials in the northern district briefed reporters on Monday. As many as 40 are feared dead.'
    expect(quoted('Fire officials in the northern district said as many as 40 may have died.', support)).toBe('As many as 40 are feared dead.')
  })

  it('quotes the first of two sentences when it is the one that states the fact', () => {
    const support = 'The council approved a $40 million budget for schools on Tuesday. Critics said the plan came too late.'
    expect(quoted('The council approved a $40 million budget for schools.', support)).toBe('The council approved a $40 million budget for schools on Tuesday.')
  })

  it('quotes the second of two sentences when it is the one that states the fact', () => {
    const support = 'Governor Alicia Park toured the region on Sunday. Flooding had destroyed 300 homes in the valley, she said.'
    expect(quoted('Flooding destroyed 300 homes in the valley.', support)).toBe('Flooding had destroyed 300 homes in the valley, she said.')
  })

  it('quotes the later sentence when both share as much with the statement', () => {
    const support = "The wheat board's chief analyst spoke on Monday. Prices have climbed steeply since then."
    expect(quoted('Wheat prices doubled.', support)).toBe('Prices have climbed steeply since then.')
  })

  it('matches a number whatever separates its thousands', () => {
    const support = 'Some 6.000 left their homes overnight. Rescuers worked until dawn.'
    expect(quoted('About 6,000 people were evacuated.', support)).toBe('Some 6.000 left their homes overnight.')
  })

  it("matches a support in another language by the statement's names and numbers", () => {
    const support = 'Ferrer anunció que la ciudad cerrará 12 parques en agosto. La alcaldesa habló el lunes ante la prensa.'
    expect(quoted('Mayor Lucía Ferrer said the city will close 12 parks in August.', support)).toBe(
      'Ferrer anunció que la ciudad cerrará 12 parques en agosto.',
    )
  })

  it('quotes one sentence of a support that holds three', () => {
    const support = 'Engineers inspected the dam on Monday morning. It then released 40 cubic meters of water per second. Residents downstream were warned.'
    expect(quoted('The dam released 40 cubic meters of water per second.', support)).toBe('It then released 40 cubic meters of water per second.')
  })

  it('splits a Chinese support at its full stops, which take no space, and reads a number set between its characters', () => {
    expect(quoted('The plant employs 3,000 workers.', '工厂位于合肥。该工厂雇用3000名工人。工厂去年投产。')).toBe('该工厂雇用3000名工人。')
  })

  it("quotes the sentence that gives the statement's number over the one that only names its speaker", () => {
    const support = 'The Northern Relief Coordination Council released new figures on Tuesday. It put the number of displaced at 4,200.'
    expect(quoted('The Northern Relief Coordination Council said 4,200 people were displaced.', support)).toBe('It put the number of displaced at 4,200.')
  })

  it('takes a year or a day of a month in the statement as its date, not as a figure that outranks words', () => {
    const support =
      'On November 3, the capital announced which states may use the strait. A senior lawmaker said ships from four countries are exempt from the transit rules.'
    expect(quoted('On November 3, a lawmaker said ships from four countries were exempt from the transit rules.', support)).toBe(
      'A senior lawmaker said ships from four countries are exempt from the transit rules.',
    )
    const since = 'The two countries have been adversaries since the 1979 revolution. They have clashed over sanctions, shipping and regional proxies.'
    expect(quoted('Since 1979 the two countries have clashed over sanctions, shipping and regional proxies.', since)).toBe(
      'They have clashed over sanctions, shipping and regional proxies.',
    )
  })

  it('ends a sentence at an ellipsis that a capital follows, as a quotation cut between two sentences has it', () => {
    const support = '“Prices have risen for months… This increase is the result of the blockade,” the minister said.'
    expect(quoted('The minister blamed the blockade for the increase.', support)).toBe('This increase is the result of the blockade,” the minister said.')
  })

  it('counts the digits of a name ("COVID-19", "H5N1") as part of the name, never as a number', () => {
    const covid = 'Health officials gave a COVID-19 briefing on Tuesday. They said deaths were falling across the region.'
    expect(quoted('Health officials said COVID-19 deaths were falling across the region.', covid)).toBe('They said deaths were falling across the region.')
    const flu = 'The ministry confirmed H5N1 on a farm near the coast. It ordered 5 farms closed.'
    expect(quoted('The ministry closed 5 farms after confirming H5N1.', flu)).toBe('It ordered 5 farms closed.')
  })

  it('takes a bracketed ellipsis as the place a search joined two passages, and quotes neither it nor both', () => {
    const support = 'The council approved the budget on Tuesday. [...] Subscribe to our morning newsletter'
    expect(quoted('The council approved the budget.', support)).toBe('The council approved the budget on Tuesday.')
  })

  it('quotes nothing of an empty support', () => {
    expect(quoted('The outlet published this on Nov 3.', '')).toBe('')
  })
})

describe('citationsOf', () => {
  const fact = (statement: string, supportingSentence: string) => ({ statement, supportingSentence })
  const flooding = fact(
    'Flooding destroyed 300 homes in the valley.',
    'Governor Alicia Park toured the region on Sunday. Flooding had destroyed 300 homes in the valley, she said.',
  )
  const budget = fact('The council approved the budget.', 'The council approved the budget on Tuesday.')
  const shelters = fact('The city funded two shelters.', 'The city approved $1.5 million for two new shelters.')
  const dated = fact('The outlet published this on Nov 3.', '')

  it('cites each source once, in the order the sources are first cited, with its first fact', () => {
    const cited = [
      { sourceId: 'S2', fact: budget },
      { sourceId: 'S0', fact: shelters },
      { sourceId: 'S2', fact: shelters },
    ]
    expect(citationsOf(cited)).toEqual([
      { sourceId: 'S2', sentence: 'The council approved the budget on Tuesday.' },
      { sourceId: 'S0', sentence: 'The city approved $1.5 million for two new shelters.' },
    ])
  })

  it('quotes the one sentence of a support that states the fact, never the whole support', () => {
    expect(citationsOf([{ sourceId: 'S1', fact: flooding }])).toEqual([
      { sourceId: 'S1', sentence: 'Flooding had destroyed 300 homes in the valley, she said.' },
    ])
  })

  it('gives a source first cited by its date the sentence of its next cited fact that has a support', () => {
    const cited = [
      { sourceId: 'S1', fact: dated },
      { sourceId: 'S1', fact: flooding },
      { sourceId: 'S1', fact: budget },
    ]
    expect(citationsOf(cited)).toEqual([{ sourceId: 'S1', sentence: 'Flooding had destroyed 300 homes in the valley, she said.' }])
  })

  it('cites a source by its date alone with no sentence', () => {
    expect(citationsOf([{ sourceId: 'S1', fact: dated }])).toEqual([{ sourceId: 'S1', sentence: null }])
  })
})
