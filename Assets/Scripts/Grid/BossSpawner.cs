using Core.Entities;
using Services;
using Services.EventBus;
using Services.Grid;
using UnityEngine;

namespace Grid
{
    [RequireComponent(typeof(Cell))]
    public class BossSpawner : MonoBehaviour
    {
        [SerializeField] private Entity entityPrefab;

        private GridService _gridService;

        private Cell _cell;

        private void OnEnable()
        {
            EventBusService.Subscribe(Actions.AllQuestCompleted, _spawn);
        }

        private void OnDisable()
        {
            EventBusService.Unsubscribe(Actions.AllQuestCompleted, _spawn);
        }

        private void Start()
        {
            _cell = GetComponent<Cell>();
        }

        private void _spawn()
        {
            var gridService = ServiceLocator.Get<GridService>();
            
            _cell.SetType(CellType.Movable);

            var boss = gridService.SpawnEntity(entityPrefab, _cell);
            
            boss.Health.OnDie.AddListener(() =>
            {
                EventBusService.Trigger(Actions.BossDied);
            });
        }
    }
}