const express = require('express');
const router = express.Router();
const { supabase } = require('../utils/supabase');
const { analyzeJobText } = require('../services/jobAnalyzer');

/**
 * POST /:id/resolve
 * Mark an issue as resolved by a user and recalculate the score
 */
router.post('/:id/resolve', async (req, res) => {
  try {
    const optimizationId = req.params.id;
    const { issue_category, issue_summary } = req.body;
    
    console.log('[DEBUG] resolve-issue: Starting resolution for optimization:', optimizationId);
    
    if (!issue_category || !issue_summary) {
      return res.status(400).json({ 
        error: 'Both issue_category and issue_summary are required' 
      });
    }

    // 1. Fetch the optimization record to get the optimized text and current score
    const { data: optimization, error: optimizationError } = await supabase
      .from('optimizations')
      .select('*')
      .eq('id', optimizationId)
      .single();
    
    if (optimizationError || !optimization) {
      console.log('[DEBUG] resolve-issue: Optimization not found:', optimizationError);
      return res.status(404).json({ error: 'Optimization not found' });
    }

    // 2. Insert resolution record
    console.log('[DEBUG] resolve-issue: Inserting resolution record');
    const { data: resolution, error: insertError } = await supabase
      .from('resolutions')
      .insert({
        optimization_id: optimizationId,
        issue_category,
        issue_summary,
        resolved_by_user_id: null // Will be set by auth when user system is integrated
      })
      .select('*')
      .single();
    
    if (insertError) {
      // Check if it's a duplicate resolution
      if (insertError.code === '23505') { // Unique constraint violation
        return res.status(409).json({ 
          error: 'This issue has already been marked as resolved',
          details: insertError.message 
        });
      }
      console.error('Error inserting resolution:', insertError);
      return res.status(500).json({ 
        error: 'Failed to save resolution', 
        details: insertError.message 
      });
    }

    // 3. Fetch all resolved issues for this optimization
    console.log('[DEBUG] resolve-issue: Fetching all resolved issues for score recalculation');
    const { data: allResolutions, error: resolutionsError } = await supabase
      .from('resolutions')
      .select('issue_category, issue_summary')
      .eq('optimization_id', optimizationId);
    
    if (resolutionsError) {
      console.warn('Error fetching resolutions for score calculation:', resolutionsError);
      // Continue without score update
    } else {
      // 4. Recalculate score with bonuses for resolved issues
      console.log('[DEBUG] resolve-issue: Recalculating score with resolved issues');
      const newScore = await recalculateScore(
        optimization.optimized_text, 
        optimization.optimized_score,
        allResolutions || []
      );

      // 5. Update the optimization record with new score
      const { error: updateError } = await supabase
        .from('optimizations')
        .update({ optimized_score: newScore })
        .eq('id', optimizationId);
      
      if (updateError) {
        console.warn('Error updating optimization score:', updateError);
        // Don't fail the request - resolution was still saved successfully
      } else {
        console.log('[DEBUG] resolve-issue: Updated optimization score from', optimization.optimized_score, 'to', newScore);
      }
    }

    // 6. Return success response
    res.json({
      message: 'Issue resolved successfully',
      resolution_id: resolution.id,
      optimization_id: optimizationId,
      issue_category,
      issue_summary,
      resolved_at: resolution.resolved_at
    });

  } catch (error) {
    console.error('Error resolving issue:', error);
    res.status(500).json({ 
      error: 'Failed to resolve issue', 
      details: error.message 
    });
  }
});

/**
 * GET /:id/resolutions
 * Get all resolutions for an optimization
 */
router.get('/:id/resolutions', async (req, res) => {
  try {
    const optimizationId = req.params.id;
    
    const { data: resolutions, error } = await supabase
      .from('resolutions')
      .select('*')
      .eq('optimization_id', optimizationId)
      .order('resolved_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching resolutions:', error);
      return res.status(500).json({ 
        error: 'Failed to fetch resolutions', 
        details: error.message 
      });
    }
    
    res.json(resolutions || []);
  } catch (error) {
    console.error('Error in resolutions endpoint:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message 
    });
  }
});

/**
 * DELETE /:optimization_id/resolutions/:resolution_id
 * Remove a resolution (un-resolve an issue)
 */
router.delete('/:optimization_id/resolutions/:resolution_id', async (req, res) => {
  try {
    const { optimization_id, resolution_id } = req.params;
    
    // Delete the resolution
    const { error: deleteError } = await supabase
      .from('resolutions')
      .delete()
      .eq('id', resolution_id)
      .eq('optimization_id', optimization_id);
    
    if (deleteError) {
      console.error('Error deleting resolution:', deleteError);
      return res.status(500).json({ 
        error: 'Failed to delete resolution', 
        details: deleteError.message 
      });
    }

    // Recalculate score after removing the resolution
    const { data: optimization } = await supabase
      .from('optimizations')
      .select('optimized_text, optimized_score')
      .eq('id', optimization_id)
      .single();

    if (optimization) {
      const { data: remainingResolutions } = await supabase
        .from('resolutions')
        .select('issue_category, issue_summary')
        .eq('optimization_id', optimization_id);

      const newScore = await recalculateScore(
        optimization.optimized_text,
        optimization.optimized_score,
        remainingResolutions || []
      );

      await supabase
        .from('optimizations')
        .update({ optimized_score: newScore })
        .eq('id', optimization_id);
    }

    res.json({ message: 'Resolution removed successfully' });
  } catch (error) {
    console.error('Error removing resolution:', error);
    res.status(500).json({ 
      error: 'Failed to remove resolution', 
      details: error.message 
    });
  }
});

/**
 * Recalculate optimization score with virtual bonuses for resolved issues
 */
async function recalculateScore(optimizedText, originalScore, resolvedIssues) {
  try {
    console.log('[DEBUG] recalculateScore: Starting with', resolvedIssues.length, 'resolved issues');
    
    // Get base score by re-analyzing the optimized text
    const analysisResult = await analyzeJobText(optimizedText);
    let baseScore = analysisResult.total_score;
    
    console.log('[DEBUG] recalculateScore: Base score from analysis:', baseScore);
    
    // Apply virtual bonuses for each resolved issue
    let bonusPoints = 0;
    const issueBonuses = {
      // Compensation-related issues
      'missing salary': 8,
      'salary': 8,
      'compensation': 8,
      'pay': 5,
      'benefits': 4,
      
      // Structure and clarity issues
      'formatting': 5,
      'structure': 5,
      'clarity': 4,
      'organization': 4,
      
      // Content completeness issues
      'missing requirements': 6,
      'missing responsibilities': 6,
      'missing qualifications': 6,
      'incomplete information': 4,
      
      // Inclusivity and bias issues
      'inclusive language': 5,
      'bias': 6,
      'diversity': 5,
      
      // SEO and targeting issues
      'keywords': 3,
      'seo': 3,
      'targeting': 3,
      
      // Default bonus for any unmatched issue
      'default': 2
    };
    
    for (const resolution of resolvedIssues) {
      const issueText = (resolution.issue_category + ' ' + resolution.issue_summary).toLowerCase();
      
      // Find the best matching bonus
      let appliedBonus = issueBonuses.default;
      for (const [keyword, bonus] of Object.entries(issueBonuses)) {
        if (keyword !== 'default' && issueText.includes(keyword)) {
          appliedBonus = Math.max(appliedBonus, bonus);
        }
      }
      
      bonusPoints += appliedBonus;
      console.log('[DEBUG] recalculateScore: Applied bonus of', appliedBonus, 'for issue:', issueText.substring(0, 50));
    }
    
    // Calculate final score, capped at 100
    const finalScore = Math.min(100, baseScore + bonusPoints);
    
    console.log('[DEBUG] recalculateScore: Final calculation - base:', baseScore, '+ bonus:', bonusPoints, '= final:', finalScore);
    
    return finalScore;
  } catch (error) {
    console.error('Error in recalculateScore:', error);
    // Return original score as fallback
    return originalScore;
  }
}

module.exports = router;
