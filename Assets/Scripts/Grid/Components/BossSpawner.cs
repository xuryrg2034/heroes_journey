using Entities;
using Services;
using Services.EventBus;
using UnityEngine;
using UnityEngine.Serialization;

namespace Grid.Components

{
    [RequireComponent(typeof(Cell))]
    public class BossSpawner : MonoBehaviour
    {
        [FormerlySerializedAs("entityPrefab")] [SerializeField] private BaseEntity baseEntityPrefab;

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

            // var boss = gridService.SpawnEntity(baseEntityPrefab, _cell);
            //
            // boss.Health.OnDie.AddListener(() =>
            // {
            //     EventBusService.Trigger(Actions.BossDied);
            // });
        }
    }
}