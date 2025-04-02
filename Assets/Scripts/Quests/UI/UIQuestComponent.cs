using TMPro;
using UnityEngine;

namespace Quests
{
    public class UIQuestComponent : MonoBehaviour
    {
        [SerializeField] TMP_Text description;
        [SerializeField] TMP_Text progress;

        BaseQuestItem _baseQuest;

        public void Init(BaseQuestItem baseQuest)
        {
            _baseQuest = baseQuest;
            _baseQuest.OnUpdate.AddListener(_updateStatus);
            
            _updateStatus();
        }
        
        public void SetDescription(string value)
        {
            description.text = value;
        }
        
        public void SetProgress(string value)
        {
            progress.text = value;
        }

        void _updateStatus()
        {
            SetDescription(_baseQuest.Title);
            SetProgress(_baseQuest.GetProgress());
        }
    }
}