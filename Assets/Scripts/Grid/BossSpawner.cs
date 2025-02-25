using System.Collections.Generic;
using System.Linq;
using Core.Entities;
using Core.Quest;
using Services;
using Services.Grid;
using UnityEngine;

namespace Grid
{
    public class BossSpawner : MonoBehaviour
    {
        // [SerializeField] private Enemy bossPrefab;
        [SerializeField] private Cell cellPrefab;
        [SerializeField] private List<QuestItem> activationQuests; 

        private GridService _gridService;

        private void Start()
        {
            _gridService = GetComponent<GridService>();
            GameService.OnGameStateChange.AddListener(_spawn);
        }

        private void _spawn(GameState state)
        {
            if (state != GameState.QuestCheck) return;

            var allQuestsComplete = activationQuests.All(item => item.IsCompleted);

            if (!allQuestsComplete) return;
            
            // _gridService.SpawnEntity(bossPrefab, cellPrefab);
            GameService.OnGameStateChange.AddListener(_spawn);
        }
    }
}