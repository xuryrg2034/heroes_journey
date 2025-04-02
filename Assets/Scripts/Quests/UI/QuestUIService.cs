using System.Collections.Generic;
using UnityEngine;

namespace Quests
{
    public class QuestUIService : MonoBehaviour
    {
        [SerializeField] Transform containerPrefab;
        [SerializeField] GameObject itemPrefab;

        QuestService _service;
        
        public void Init(QuestService service)
        {
            _service = service;

            _updateUI(_service.GetQuests());
        }

        void _updateUI(List<BaseQuestItem> questsList)
        {
            // Очистим контейнер
            foreach (Transform child in containerPrefab)
            {
                Destroy(child.gameObject);
            }
            
            // Выведем каждый квест
            foreach (var quest in questsList)
            {
                var questItem = Instantiate(itemPrefab, containerPrefab);
                var uiItem = questItem.GetComponent<UIQuestComponent>();

                if (uiItem == null) continue;
                
                uiItem.Init(quest);
            }
        }
        
    }
}